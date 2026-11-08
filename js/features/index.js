// Enabled features. Add a feature = new file + one line here.
import * as conditions from './conditions.js';
import * as annotations from './annotations.js?v=draft-autosave-1';
import * as reorder from './reorder.js';
import * as customFields from './customFields.js';
export const initFeatures = () => [conditions, annotations, reorder, customFields].forEach(f => f.init());
