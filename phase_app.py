"""
Market Phase Lab  -  run with:  streamlit run phase_app.py
Needs: pip install streamlit plotly scikit-learn yfinance pandas numpy
"""
import warnings
import numpy as np, pandas as pd, yfinance as yf
import streamlit as st
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")
st.set_page_config(page_title="Market Phase Lab", page_icon="📈", layout="wide")

# ============================== constants ==============================
PRESETS = {
    "Gold futures (GC=F)": "GC=F",
    "Gold ETF (GLD)": "GLD",
    "Silver futures (SI=F)": "SI=F",
    "Crude oil (CL=F)": "CL=F",
    "S&P 500 index (^GSPC)": "^GSPC",
    "S&P 500 ETF (SPY)": "SPY",
    "Nasdaq 100 ETF (QQQ)": "QQQ",
    "Nifty 50 (^NSEI)": "^NSEI",
    "Bank Nifty (^NSEBANK)": "^NSEBANK",
    "EUR/USD": "EURUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USD/JPY": "USDJPY=X",
    "AUD/USD": "AUDUSD=X",
    "USD/INR": "INR=X",
    "Bitcoin (BTC-USD)": "BTC-USD",
    "Ethereum (ETH-USD)": "ETH-USD",
    "Demo (synthetic data, offline test)": "DEMO",
}
TIMEFRAMES = {
    "W1": dict(interval="1wk", start="2000-01-01"),
    "D1": dict(interval="1d", start="2000-01-01"),
    "H4": dict(interval="1h", period="730d", resample="4h"),   # Yahoo has no 4h feed
    "H1": dict(interval="1h", period="730d"),
}
STATE_CODE = {"TREND": 0, "CONTRACTION": 1, "CONSOLIDATION": 2, "EXPANSION": 3}
COLORS = {"TREND": (46, 134, 222), "CONTRACTION": (243, 156, 18),
          "CONSOLIDATION": (127, 140, 141), "EXPANSION": (155, 89, 182)}
LEVEL_COLS = ["dist_poc", "hvn_up", "hvn_dn", "res_dist", "res_touch",
              "sup_dist", "sup_touch", "range_pos"]
FEATS = ["adx", "er20", "er10", "atr_ratio", "bbw_pct", "compression", "width_atr",
         "hi_slope", "lo_slope", "disp", "ext", "vol_ratio",
         "sweep_hi_recent", "sweep_lo_recent", "state_code", "state_age"] + LEVEL_COLS
CORE = [f for f in FEATS if f != "vol_ratio"]
STALL_ER = 0.15      # a TREND whose efficiency falls below this is no longer called a trend


def rgba(state, a):
    r, g, b = COLORS[state]
    return f"rgba({r},{g},{b},{a})"


def show_fig(fig):
    try:
        st.plotly_chart(fig, width="stretch")
    except Exception:
        st.plotly_chart(fig, use_container_width=True)


def show_df(df):
    try:
        st.dataframe(df, width="stretch", hide_index=True)
    except Exception:
        st.dataframe(df, use_container_width=True, hide_index=True)


# ============================== data ==============================
def demo_data(tf):
    rng = np.random.default_rng(7)
    segs = []
    for i in range(80):
        n = int(rng.integers(30, 110))
        drift, vol = [(0.004, 0.008), (0.0, 0.004), (0.0, 0.009), (-0.003, 0.008)][i % 4]
        r = rng.normal(drift, vol, n)
        if i % 4 == 1:
            r *= np.linspace(1.5, 0.4, n)
        segs.append(r)
    r = np.concatenate(segs)
    close = 1800 * np.exp(np.cumsum(r))
    opn = np.concatenate([[close[0]], close[:-1]])
    hi = np.maximum(opn, close) * (1 + np.abs(rng.normal(0, 0.003, len(r))))
    lo = np.minimum(opn, close) * (1 - np.abs(rng.normal(0, 0.003, len(r))))
    freq = {"W1": "W", "D1": "B", "H4": "4h", "H1": "h"}[tf]
    end = pd.Timestamp.today().normalize()
    idx = pd.date_range(end=end, periods=len(r), freq=freq)
    return pd.DataFrame({"Open": opn, "High": hi, "Low": lo, "Close": close,
                         "Volume": rng.integers(1000, 5000, len(r)).astype(float)}, index=idx)


@st.cache_data(ttl=900, show_spinner="Downloading price data...")
def get_df(ticker, tf, drop_forming):
    if ticker == "DEMO":
        df = demo_data(tf)
    else:
        cfg = TIMEFRAMES[tf]
        kw = dict(interval=cfg["interval"], auto_adjust=True, progress=False)
        if "period" in cfg:
            kw["period"] = cfg["period"]
        else:
            kw["start"] = cfg["start"]
        df = yf.download(ticker, **kw)
        if df is None or df.empty:
            raise ValueError(f"No data returned for {ticker} ({tf}). Check the symbol or try another timeframe.")
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        if getattr(df.index, "tz", None) is not None:
            df.index = df.index.tz_localize(None)
        if cfg.get("resample"):
            df = df.resample(cfg["resample"]).agg({"Open": "first", "High": "max", "Low": "min",
                                                   "Close": "last", "Volume": "sum"}).dropna(subset=["Close"])
    df = df.dropna(subset=["Close"])
    if drop_forming:
        df = df.iloc[:-1]
    return df


# ============================== indicators (past data only) ==============================
def atr(h, l, c, n=14):
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def adx(h, l, c, n=14):
    up, dn = h.diff(), -l.diff()
    plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=h.index)
    minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=h.index)
    a = atr(h, l, c, n)
    pdi = 100 * plus.ewm(alpha=1 / n, adjust=False).mean() / a
    mdi = 100 * minus.ewm(alpha=1 / n, adjust=False).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def roll_slope(s, n=20):
    x = np.arange(n) - (n - 1) / 2
    return s.rolling(n).apply(lambda y: np.dot(x, y) / np.dot(x, x), raw=True)


def level_features(df, a, W=120, bins=30, k=5):
    """Volume-profile nodes + confirmed swing highs/lows, in ATR units."""
    Hh, Ll, Cc = df.High.values, df.Low.values, df.Close.values
    V = df.Volume.values.astype(float)
    if V.sum() == 0:
        V = np.ones_like(V)                         # no volume (forex): time-at-price instead
    TP = (Hh + Ll + Cc) / 3
    ph = (df.High == df.High.rolling(2 * k + 1, center=True).max()).values
    pl = (df.Low == df.Low.rolling(2 * k + 1, center=True).min()).values
    av = a.values
    n = len(df)
    out = np.full((n, len(LEVEL_COLS)), np.nan)
    for t in range(W, n):
        at = av[t]
        if not np.isfinite(at) or at == 0:
            continue
        s = slice(t - W + 1, t + 1)
        hist, edges = np.histogram(TP[s], bins=bins, weights=V[s])
        ctr = (edges[:-1] + edges[1:]) / 2
        c = Cc[t]
        poc = ctr[hist.argmax()]
        hv = hist >= np.quantile(hist, 0.8)
        up, dn = ctr[hv & (ctr > c)], ctr[hv & (ctr < c)]
        hvn_up = (up.min() - c) / at if len(up) else 10.0
        hvn_dn = (c - dn.max()) / at if len(dn) else 10.0
        idx = np.arange(t - W + 1, t - k + 1)       # pivots only count once k bars old (no lookahead)
        hi_lv, lo_lv = Hh[idx[ph[idx]]], Ll[idx[pl[idx]]]
        above, below = hi_lv[hi_lv > c], lo_lv[lo_lv < c]
        if len(above):
            r = above.min()
            res_dist, res_touch = (r - c) / at, float(np.sum(np.abs(hi_lv - r) <= 0.5 * at))
        else:
            res_dist, res_touch = 10.0, 0.0
        if len(below):
            sp = below.max()
            sup_dist, sup_touch = (c - sp) / at, float(np.sum(np.abs(lo_lv - sp) <= 0.5 * at))
        else:
            sup_dist, sup_touch = 10.0, 0.0
        rng = Hh[s].max() - Ll[s].min()
        out[t] = [(c - poc) / at, hvn_up, hvn_dn, res_dist, res_touch,
                  sup_dist, sup_touch, (c - Ll[s].min()) / (rng + 1e-9)]
    return out


# ============================== phase labels + features ==============================
def build(df, H):
    h, l, c = df.High, df.Low, df.Close
    d = pd.DataFrame(index=df.index)
    a = atr(h, l, c)
    d["open"], d["high"], d["low"], d["close"], d["atr"] = df.Open, h, l, c, a
    d["adx"] = adx(h, l, c)
    d["er20"] = (c - c.shift(20)).abs() / c.diff().abs().rolling(20).sum()
    d["er10"] = (c - c.shift(10)).abs() / c.diff().abs().rolling(10).sum()
    d["atr_ratio"] = a / a.rolling(100).mean()
    bbw = (4 * c.rolling(20).std()) / c.rolling(20).mean()
    d["bbw_pct"] = bbw.rolling(252, min_periods=100).apply(lambda x: (x[-1] >= x).mean(), raw=True)

    rng_recent = h.rolling(10).max() - l.rolling(10).min()
    rng_prior = h.shift(10).rolling(20).max() - l.shift(10).rolling(20).min()
    d["compression"] = rng_recent / rng_prior
    d["width_atr"] = (h.rolling(20).max() - l.rolling(20).min()) / a
    d["hi_slope"] = roll_slope(h) / a
    d["lo_slope"] = roll_slope(l) / a
    d["disp"] = (c - c.shift(20)) / a
    d["ext"] = (c - c.rolling(50).mean()) / a
    v = df.Volume.astype(float)
    d["vol_ratio"] = v / v.rolling(50).mean() if v.sum() > 0 else np.nan

    ph20, pl20 = h.rolling(20).max().shift(1), l.rolling(20).min().shift(1)
    big = (h - l) >= a
    sweep_hi = ((h > ph20) & (c < ph20) & big).astype(float)
    sweep_lo = ((l < pl20) & (c > pl20) & big).astype(float)
    d["sweep_hi_recent"] = sweep_hi.rolling(5).max()
    d["sweep_lo_recent"] = sweep_lo.rolling(5).max()

    trend = (d.adx > 22) & (d.er20 > 0.30) & (d.disp.abs() > 2.5)
    expan = ((d.sweep_hi_recent == 1) | (d.sweep_lo_recent == 1)) | \
            ((d.atr_ratio > 1.25) & (d.er20 < 0.30))
    contr = (d.compression < 0.70) & (d.bbw_pct < 0.35)
    cons = (d.er20 < 0.25) & (d.adx < 22)
    raw = np.select([trend.values, expan.values, contr.values, cons.values],
                    ["TREND", "EXPANSION", "CONTRACTION", "CONSOLIDATION"], default="NONE")
    prev, out = None, []
    for s, er in zip(raw, d.er20.values):
        if s != "NONE":
            prev = s
        elif prev == "TREND" and er < STALL_ER:
            prev = "CONSOLIDATION"                    # trend has stalled
        out.append(prev if prev is not None else np.nan)
    state = pd.Series(out, index=d.index, dtype=object)
    d["state"] = state
    d["state_code"] = state.map(STATE_CODE)
    grp = (state != state.shift()).cumsum()
    d["state_age"] = state.groupby(grp).cumcount() + 1

    lv = level_features(df, a)
    for i, name in enumerate(LEVEL_COLS):
        d[name] = lv[:, i]

    d["fut_state"] = d["state"].shift(-H)
    d["fut_disp"] = d["disp"].shift(-H)
    d["is_trend"] = d["state"] == "TREND"
    return d


# ============================== transition models ==============================
# TREND rows     -> event = 1 if the trend has ended H bars later
# non-TREND rows -> event = 1 if a trend is running H bars later
def make_model():
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=120,
                                          l2_regularization=2.0, random_state=0)


def get_data(d, flip):
    data = d.dropna(subset=CORE + ["state", "fut_state", "fut_disp"]).copy()
    ended = data.fut_state != "TREND"
    if flip:
        ended = ended | (np.sign(data.fut_disp) != np.sign(data.disp))
    data["event"] = np.where(data.is_trend, ended, data.fut_state == "TREND").astype(int)
    return data


def walk_forward(data, H):
    X, y = data[FEATS], data["event"]
    flags = data.is_trend.values
    p = pd.Series(np.nan, index=data.index)
    for tr, te in TimeSeriesSplit(n_splits=5, gap=H).split(X):
        for f in (True, False):
            tri, tei = tr[flags[tr] == f], te[flags[te] == f]
            if len(tri) < 100 or len(tei) == 0 or y.iloc[tri].nunique() < 2:
                continue
            p.iloc[tei] = make_model().fit(X.iloc[tri], y.iloc[tri]).predict_proba(X.iloc[tei])[:, 1]
    return p


def metrics(y, p):
    ok = p.notna()
    y, p = y[ok], p[ok]
    if len(y) < 50 or y.nunique() < 2:
        return None
    base = y.mean()
    q = pd.qcut(p.rank(method="first"), 4, labels=False)
    return dict(n=len(y), base=base, acc=((p > 0.5) == y).mean(), maj=max(base, 1 - base),
                auc=roc_auc_score(y, p), by_q=y.groupby(q).mean(),
                hi=y[p >= p.quantile(0.75)].mean(), lo=y[p <= p.quantile(0.25)].mean())


@st.cache_data(ttl=900, show_spinner="Analysing market phases (10-40 seconds the first time)...")
def analyse(ticker, tf, H, flip, drop_forming):
    df = get_df(ticker, tf, drop_forming)
    if len(df) < 400:
        return dict(error=f"Only {len(df)} bars available for {ticker} {tf}. Try D1, or another symbol.")
    d = build(df, H)
    data = get_data(d, flip)
    if len(data) < 500:
        return dict(error=f"Only {len(data)} usable bars after warm-up. Try D1, or another symbol.")
    p = walk_forward(data, H)
    t = data.is_trend
    X, y = data[FEATS], data["event"]
    models = {f: make_model().fit(X[data.is_trend == f], y[data.is_trend == f]) for f in (True, False)}

    d["p"] = np.nan
    d.loc[data.index, "p"] = p
    tail = [ix for ix in d.index[d.index > data.index[-1]] if d.loc[ix, CORE].notna().all()]
    for f in (True, False):                          # newest bars: no outcome yet, use the final model
        rows = [ix for ix in tail if bool(d.at[ix, "is_trend"]) == f]
        if rows:
            d.loc[rows, "p"] = models[f].predict_proba(d.loc[rows, FEATS])[:, 1]

    s = d.state.dropna()
    runs = (s != s.shift()).cumsum()
    lengths = s.groupby(runs).agg(["first", "size"]).groupby("first")["size"].agg(["count", "mean", "median"])
    share = s.value_counts(normalize=True)
    trans = pd.crosstab(data.state, data.fut_state, normalize="index")
    return dict(d=d, data=data, models=models, rep_end=metrics(y[t], p[t]), rep_start=metrics(y[~t], p[~t]),
                base_end=y[t].mean(), base_start=y[~t].mean(), lengths=lengths, share=share,
                trans=trans, n_df=len(df))


def min_train_rows(data):
    return max(250, int(0.35 * len(data)))


@st.cache_data(ttl=900, show_spinner=False)
def predict_at(_data, _d, key, H, i):
    X, y = _data[FEATS], _data["event"]
    flags = _data.is_trend.values
    f = bool(flags[i])
    tr = np.arange(0, i - H + 1)                    # these rows' outcomes were already known by bar i
    tr = tr[flags[tr] == f]
    if len(tr) < 150 or y.iloc[tr].nunique() < 2:
        return None
    p = make_model().fit(X.iloc[tr], y.iloc[tr]).predict_proba(X.iloc[[i]])[0, 1]
    r = _data.iloc[i]
    pos = _d.index.get_loc(_data.index[i])
    later = _d.close.iloc[min(pos + H, len(_d) - 1)]
    return dict(date=_data.index[i], pos=pos, flag=f, p=float(p), event=int(r.event), state=r.state,
                up=bool(r.disp > 0), age=int(r.state_age), fut_state=r.fut_state, move=later / r.close - 1)


@st.cache_data(ttl=900, show_spinner="Scoring random historical points...")
def score_random(_data, _d, key, H, n, seed):
    rng = np.random.default_rng(seed)
    lo = min_train_rows(_data)
    flags = _data.is_trend.values
    rows = []
    for f in (True, False):
        cand = np.array([i for i in range(lo, len(_data)) if flags[i] == f])
        if len(cand) == 0:
            continue
        for i in sorted(rng.choice(cand, size=min(n // 2, len(cand)), replace=False)):
            r = predict_at(_data, _d, key, H, int(i))
            if r is None:
                continue
            call = (r["p"] > 0.5)
            rows.append({
                "Date": r["date"].strftime("%Y-%m-%d %H:%M") if r["date"].hour else r["date"].strftime("%Y-%m-%d"),
                "Phase then": r["state"] + (" (UP)" if r["up"] else " (DOWN)") * r["flag"],
                "Question": "Will the trend end?" if r["flag"] else "Will a trend start?",
                "Model said": f"{r['p']:.0%}",
                f"After {H} bars": r["fut_state"],
                "Price move": f"{r['move']:+.1%}",
                "Outcome": "trend ended" if (r["flag"] and r["event"]) else
                           "trend continued" if r["flag"] else
                           "trend started" if r["event"] else "no trend",
                "Result": "✅ right" if call == bool(r["event"]) else "❌ wrong",
            })
    return pd.DataFrame(rows)


# ============================== charting ==============================
def axis_breaks(idx, tf):
    if len(idx) < 3:
        return []
    if tf == "D1":
        full = pd.date_range(idx[0].normalize(), idx[-1].normalize(), freq="D")
        missing = full.difference(idx.normalize())
        return [dict(values=missing.strftime("%Y-%m-%d").tolist())] if len(missing) else []
    if tf in ("H1", "H4") and (idx.dayofweek >= 5).sum() < 0.10 * len(idx):
        return [dict(bounds=["sat", "mon"])]
    return []


def level_prices(r):
    px, at = r.close, r.atr
    out = [("Point of control", px - r.dist_poc * at, "#8E44AD", "dot")]
    if r.hvn_up < 10:
        out.append(("Heavy volume above", px + r.hvn_up * at, "#8E44AD", "dash"))
    if r.hvn_dn < 10:
        out.append(("Heavy volume below", px - r.hvn_dn * at, "#8E44AD", "dash"))
    if r.res_dist < 10:
        out.append((f"Resistance (tested {int(r.res_touch)}x)", px + r.res_dist * at, "#C0392B", "dash"))
    if r.sup_dist < 10:
        out.append((f"Support (tested {int(r.sup_touch)}x)", px - r.sup_dist * at, "#27AE60", "dash"))
    return out


def make_chart(d, tf, start, end, cut_end, cut_start, levels_row=None, marker=None, fwin=None, height=820):
    v = d.iloc[start:end]
    idx = v.index
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.03,
                        row_heights=[0.58, 0.22, 0.20])
    fig.add_trace(go.Candlestick(x=idx, open=v.open, high=v.high, low=v.low, close=v.close,
                                 name="Price", showlegend=False), row=1, col=1)
    bar = (idx[1:] - idx[:-1]).median() if len(idx) > 1 else pd.Timedelta(days=1)

    s = v.state
    for _, g in v.groupby((s != s.shift()).cumsum()):
        stt = g.state.iloc[0]
        if isinstance(stt, str):
            fig.add_shape(type="rect", xref="x", yref="paper", x0=g.index[0], x1=g.index[-1] + bar,
                          y0=0, y1=1, fillcolor=rgba(stt, 0.13), line_width=0, layer="above")
    for k in COLORS:
        fig.add_trace(go.Scatter(x=[idx[0]], y=[None], mode="markers", name=k,
                                 marker=dict(size=11, color=rgba(k, 0.9), symbol="square")), row=1, col=1)
    if levels_row is not None:
        for name, y, color, dash in level_prices(levels_row):
            fig.add_hline(y=y, line_color=color, line_dash=dash, line_width=1, opacity=0.8, row=1, col=1,
                          annotation_text=name, annotation_position="top left", annotation_font_size=10)

    fig.add_trace(go.Scatter(x=idx, y=v.p.where(v.is_trend), name="P(trend ends)", mode="lines+markers",
                             line=dict(color="#E4572E", width=2), marker=dict(size=3)), row=2, col=1)
    fig.add_trace(go.Scatter(x=idx, y=v.p.where(~v.is_trend), name="P(trend starts)", mode="lines+markers",
                             line=dict(color="#17BEBB", width=2), marker=dict(size=3)), row=2, col=1)
    fig.add_hline(y=cut_end, line_dash="dot", line_color="#E4572E", opacity=0.5, row=2, col=1)
    fig.add_hline(y=cut_start, line_dash="dot", line_color="#17BEBB", opacity=0.5, row=2, col=1)
    fig.update_yaxes(range=[0, 1], tickformat=".0%", title_text="Transition risk", row=2, col=1)

    fig.add_trace(go.Scatter(x=idx, y=v.adx, name="ADX", line=dict(color="#2E86DE", width=1.5)), row=3, col=1)
    fig.add_trace(go.Scatter(x=idx, y=v.er20 * 100, name="Efficiency %", line=dict(color="#F39C12", width=1.5)), row=3, col=1)
    fig.add_trace(go.Scatter(x=idx, y=v.bbw_pct * 100, name="Squeeze percentile",
                             line=dict(color="#7F8C8D", width=1.5, dash="dot")), row=3, col=1)
    fig.update_yaxes(title_text="Indicators", row=3, col=1)

    if marker is not None:
        fig.add_shape(type="line", xref="x", yref="paper", x0=marker, x1=marker, y0=0, y1=1,
                      line=dict(color="#555", width=2, dash="dash"))
    if fwin is not None:
        fig.add_shape(type="rect", xref="x", yref="paper", x0=fwin[0], x1=fwin[1], y0=0, y1=1,
                      fillcolor="rgba(120,120,120,0.10)", line=dict(color="#888", width=1, dash="dot"), layer="above")
    br = axis_breaks(idx, tf)
    fig.update_xaxes(rangeslider_visible=False, rangebreaks=br)
    fig.update_layout(height=height, hovermode="x unified", margin=dict(l=10, r=10, t=30, b=10),
                      legend=dict(orientation="h", y=1.04, x=0))
    return fig


def readout(r, p, H, base, flag, cut_end, cut_start):
    if flag:
        way = "UP" if r.disp > 0 else "DOWN"
        txt = (f"The market is in a **{way} trend**, {int(r.state_age)} bars old. The model puts the chance that this "
               f"trend has ended {H} bars from now at **{p:.0%}**. Historically that happens about {base:.0%} of the time.")
        if p >= cut_end:
            txt += " That is clearly above normal, so treat it as a **warning that the trend may be ending**."
        elif p <= base - 0.12:
            txt += " That is below normal: the trend looks healthy by these measures."
        else:
            txt += " That is close to normal, so there is **no unusual signal** either way."
    else:
        txt = (f"The market is in **{r.state}** (for {int(r.state_age)} bars). The model puts the chance that a trend "
               f"is running {H} bars from now at **{p:.0%}**. Historically that happens about {base:.0%} of the time.")
        if p >= cut_start:
            txt += " That is elevated: a **breakout into a trend is more likely than usual**. Watch the key levels."
        else:
            txt += " There is **no sign of a trend starting yet**. Breakouts are hard to time, so this is only a rough guide."
    return txt


# ============================== sidebar ==============================
st.sidebar.title("📈 Market Phase Lab")
choice = st.sidebar.selectbox("Instrument", list(PRESETS) + ["Custom symbol..."], index=0)
ticker = PRESETS.get(choice) or st.sidebar.text_input("Yahoo Finance symbol", "GC=F").strip().upper()
tf = st.sidebar.selectbox("Timeframe", list(TIMEFRAMES), index=1,
                          help="H4 is built from 1-hour data; Yahoo only provides about 2 years of intraday history.")
H = st.sidebar.slider("Look-ahead (bars)", 5, 30, 10, help="How many bars ahead the transition forecast looks.")
show_n = st.sidebar.slider("Bars shown on chart", 100, 600, 250, step=25)
cut_end = st.sidebar.slider("Trend-end warning at", 0.40, 0.90, 0.60, 0.05)
cut_start = st.sidebar.slider("Trend-start warning at", 0.20, 0.80, 0.40, 0.05)
flip = st.sidebar.checkbox("Count a direction flip as the trend ending", value=True)
levels_on = st.sidebar.checkbox("Show key levels on chart", value=True)
drop_forming = st.sidebar.checkbox("Ignore the still-forming last bar", value=True)
if st.sidebar.button("Refresh data now"):
    st.cache_data.clear()
    st.rerun()
st.sidebar.caption("Educational tool, not financial advice. Forecasts are probabilities and are often wrong.")

# ============================== analysis ==============================
try:
    res = analyse(ticker, tf, H, flip, drop_forming)
except Exception as e:
    st.error(f"Could not load or analyse {ticker} ({tf}): {e}")
    st.stop()
if "error" in res:
    st.error(res["error"])
    st.stop()

d, data, models = res["d"], res["data"], res["models"]
key = f"{ticker}|{tf}|{H}|{flip}|{drop_forming}"
last = d.iloc[-1]
flag = bool(last.is_trend)
p_now = float(models[flag].predict_proba(d[FEATS].iloc[[-1]])[0, 1])
base = res["base_end"] if flag else res["base_start"]

st.title(f"{ticker}  ·  {tf}")
st.caption(f"{res['n_df']:,} bars · {d.index[0].date()} to {d.index[-1]} (last closed bar) · "
           f"{len(data):,} bars with known outcomes for testing")
if len(data) < 1500:
    st.warning("Small sample: results on this symbol/timeframe will be noisy. D1 has the longest history.")

tab_live, tab_tm, tab_acc, tab_stats, tab_how = st.tabs(
    ["Live view", "Time machine", "Model accuracy", "Phase statistics", "How it works"])

# ---------------------------- live view ----------------------------
with tab_live:
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Current phase", last.state + ((" ▲" if last.disp > 0 else " ▼") if flag else ""))
    c2.metric("Phase age", f"{int(last.state_age)} bars")
    c3.metric("Chance trend ends" if flag else "Chance trend starts", f"{p_now:.0%}",
              delta=f"{(p_now - base) * 100:+.0f} pts vs normal", delta_color="off")
    warn = (p_now >= cut_end) if flag else (p_now >= cut_start)
    c4.metric("Signal", ("⚠ Trend may be ending" if flag else "⚠ Breakout risk") if warn else "Nothing unusual")
    c5.metric("Last close", f"{last.close:,.2f}")
    st.info(readout(last, p_now, H, base, flag, cut_end, cut_start))

    n = len(d)
    show_fig(make_chart(d, tf, max(0, n - show_n), n, cut_end, cut_start,
                        levels_row=last if levels_on else None))
    st.caption(f"Shaded colours show the phase at each bar. The middle panel shows the model's transition risk "
               f"(earlier bars are out-of-sample forecasts; the newest {H} bars use the final model).")

    a, b = st.columns(2)
    with a:
        st.subheader("Key levels")
        lv = pd.DataFrame([(nm, round(y, 2), f"{(y / last.close - 1):+.1%}") for nm, y, _, _ in level_prices(last)],
                          columns=["Level", "Price", "From close"])
        show_df(lv)
        st.caption(f"Position in 120-bar range: {last.range_pos:.0%} (0% = bottom, 100% = top)")
    with b:
        st.subheader("Why this phase")
        sw = [t for t, c in (("buy-side liquidity swept", last.sweep_hi_recent),
                             ("sell-side liquidity swept", last.sweep_lo_recent)) if c == 1]
        show_df(pd.DataFrame({
            "Measure": ["ADX", "Efficiency (20 bars)", "Range compression", "Squeeze percentile (1y)",
                        "Stretch from 50-bar mean", "Recent sweeps"],
            "Value": [f"{last.adx:.1f}", f"{last.er20:.2f}", f"{last.compression:.2f}",
                      f"{last.bbw_pct:.0%}", f"{last.ext:+.1f} ATR", ", ".join(sw) if sw else "none"]}))
    seq = d.state.dropna().tail(80)
    runs = (seq != seq.shift()).cumsum()
    st.write("**Recent phase sequence:** " + " → ".join(f"{g.iloc[0]} ({len(g)})" for _, g in seq.groupby(runs)))

# ---------------------------- time machine ----------------------------
with tab_tm:
    st.write("Pick a moment in history. The model is retrained **only on data before that moment**, makes its call, "
             "and you see what actually happened afterwards.")
    lo_i = min_train_rows(data)
    mode = st.radio("Point in time", ["Random", "Choose a date"], horizontal=True)
    if "tm_seed" not in st.session_state:
        st.session_state.tm_seed = int(pd.Timestamp.now().timestamp()) % 100000
    if mode == "Random":
        if st.button("🎲 New random point"):
            st.session_state.tm_seed += 1
        i = int(np.random.default_rng(st.session_state.tm_seed).integers(lo_i, len(data)))
    else:
        dmin, dmax = data.index[lo_i].date(), data.index[-1].date()
        pick = st.date_input("Date", value=dmax, min_value=dmin, max_value=dmax)
        i = int(data.index.get_indexer([pd.Timestamp(pick)], method="nearest")[0])
        i = max(i, lo_i)
    r = predict_at(data, d, key, H, i)
    if r is None:
        st.warning("Not enough earlier history to train on at that point. Pick a later date.")
    else:
        call = r["p"] > 0.5
        right = call == bool(r["event"])
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Date", r["date"].strftime("%Y-%m-%d %H:%M") if r["date"].hour else r["date"].strftime("%Y-%m-%d"))
        m2.metric("Phase then", r["state"] + ((" ▲" if r["up"] else " ▼") if r["flag"] else ""),
                  delta=f"{r['age']} bars old", delta_color="off")
        m3.metric("Chance trend ends" if r["flag"] else "Chance trend starts", f"{r['p']:.0%}")
        m4.metric(f"After {H} bars", r["fut_state"], delta=f"price {r['move']:+.1%}", delta_color="off")
        (st.success if right else st.error)(
            f"Model {'warned' if call else 'did not warn'} → "
            f"{'trend ended' if (r['flag'] and r['event']) else 'trend continued' if r['flag'] else 'trend started' if r['event'] else 'no trend started'}"
            f" → **{'RIGHT' if right else 'WRONG'}**")
        pos = r["pos"]
        end = min(len(d), pos + H + 30)
        fwin = (d.index[pos], d.index[min(pos + H, len(d) - 1)])
        show_fig(make_chart(d, tf, max(0, pos - 150), end, cut_end, cut_start,
                            marker=d.index[pos], fwin=fwin, height=700))
        st.caption("Dashed line = the moment analysed. Grey box = the look-ahead window the forecast refers to.")

    st.divider()
    st.subheader("Score many random points")
    cA, cB = st.columns([1, 3])
    n_pts = cA.slider("Number of points", 6, 60, 12, step=2)
    if "sc_seed" not in st.session_state:
        st.session_state.sc_seed = 1
    if cA.button("Draw new random points"):
        st.session_state.sc_seed += 1
    tbl = score_random(data, d, key, H, n_pts, st.session_state.sc_seed)
    if len(tbl):
        right_n = int((tbl["Result"] == "✅ right").sum())
        cB.metric("Right", f"{right_n} of {len(tbl)}")
        show_df(tbl)
        st.caption("Small samples are mostly luck. Use the Model accuracy tab for the full picture. "
                   "Note: a model that always says 'no trend' also looks right most of the time on the not-in-trend rows.")

# ---------------------------- accuracy ----------------------------
with tab_acc:
    st.write(f"Every forecast below was made by a model trained **only on earlier data** (walk-forward test), "
             f"{H} bars ahead.")
    cols = st.columns(2)
    for col, rep, ttl, ev in ((cols[0], res["rep_end"], "TREND → will the trend END?", "trend ended"),
                              (cols[1], res["rep_start"], "NOT-TREND → will a TREND START?", "trend started")):
        with col:
            st.subheader(ttl)
            if rep is None:
                st.write("Not enough data.")
                continue
            m1, m2, m3 = st.columns(3)
            m1.metric("AUC", f"{rep['auc']:.2f}", help="0.50 = no skill, 1.00 = perfect")
            m2.metric("Normal rate", f"{rep['base']:.0%}", help=f"How often '{ev}' really happened")
            m3.metric("Accuracy @50%", f"{rep['acc']:.0%}", delta=f"{(rep['acc'] - rep['maj']) * 100:+.1f} vs guessing",
                      delta_color="off")
            labels = ["Least confident 25%", "25-50%", "50-75%", "Most confident 25%"]
            bq = rep["by_q"]
            fig = go.Figure(go.Bar(x=[labels[int(k)] for k in bq.index], y=bq.values,
                                   text=[f"{v:.0%}" for v in bq.values], textposition="outside",
                                   marker_color=["#95A5A6", "#95A5A6", "#95A5A6", "#E4572E" if "ENDS" in ttl else "#17BEBB"]))
            fig.add_hline(y=rep["base"], line_dash="dot", annotation_text="normal rate", annotation_position="top left")
            fig.update_layout(height=340, yaxis=dict(tickformat=".0%", range=[0, min(1, float(bq.max()) + 0.2)],
                                                     title=f"How often {ev}"),
                              margin=dict(l=10, r=10, t=30, b=10))
            show_fig(fig)
            st.caption(f"{rep['n']:,} out-of-sample bars. A useful model shows bars rising left to right.")

# ---------------------------- statistics ----------------------------
with tab_stats:
    a, b = st.columns(2)
    with a:
        st.subheader(f"What follows each phase ({H} bars later)")
        tr = res["trans"].reindex(index=list(COLORS), columns=list(COLORS)).fillna(0)
        fig = go.Figure(go.Heatmap(z=tr.values, x=[f"→ {c}" for c in tr.columns], y=tr.index,
                                   text=[[f"{v:.0%}" for v in row] for row in tr.values], texttemplate="%{text}",
                                   colorscale="Blues", showscale=False, zmin=0, zmax=0.8))
        fig.update_layout(height=360, margin=dict(l=10, r=10, t=10, b=10), yaxis=dict(autorange="reversed"))
        show_fig(fig)
        st.caption("Row = phase now, column = phase after the look-ahead. Rows add up to 100%.")
    with b:
        st.subheader("How long each phase lasts")
        ln = res["lengths"].reindex(list(COLORS)).dropna()
        out = pd.DataFrame({"Phase": ln.index, "Times seen": ln["count"].astype(int).values,
                            "Average bars": ln["mean"].round(1).values, "Median bars": ln["median"].values,
                            "Share of time": [f"{res['share'].get(k, 0):.0%}" for k in ln.index]})
        show_df(out)
        st.caption("Short average lengths mean the phase labels flip often, which limits how predictable they are.")

# ---------------------------- how it works ----------------------------
with tab_how:
    st.markdown(f"""
**Phases** (decided at each bar's close, using only past data)

| Phase | Rule |
|---|---|
| **TREND** | ADX > 22, efficient movement (efficiency > 0.30) and price displaced > 2.5 ATR over 20 bars. A trend whose efficiency drops below {STALL_ER} is no longer carried forward. |
| **EXPANSION** | A liquidity sweep in the last 5 bars (a wick takes the prior 20-bar high or low, then closes back inside), or high volatility with no direction |
| **CONTRACTION** | The last 10 bars' range is under 70% of the range before it (the funnel) and the Bollinger width is in the bottom 35% of the past year |
| **CONSOLIDATION** | Low efficiency and low ADX, but not narrowing |

**Transition forecasts** (only these two questions)
- If the market is in a TREND: *will the trend have ended in {H} bars?* (optionally also counts a direction flip)
- If it is in any other phase: *will a trend be running in {H} bars?*

The model also sees how long the phase has lasted, how stretched price is from its mean, the volume-profile point of
control and heavy-volume zones, and the nearest swing highs and lows (with how often they were tested).

**Honest limits**
- The phase rules and thresholds are my mechanical version of the concepts, not tuned values. Check them against charts.
- Trend endings are moderately predictable; trend starts much less so. Treat start probabilities as "breakout risk", and wait for confirmation.
- Forecasts are probabilities. Accuracy is not profit, and results on past data may not hold in future.
- Yahoo data can be revised, and futures are stitched across contracts. Intraday history is limited to about 2 years.
""")
