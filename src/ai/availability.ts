/** Per-build switch: the owner-only Android candidate ships without AI.
 * Existing Web/Admin previews keep their configuration independently. */
export const aiFeaturesEnabled = import.meta.env?.VITE_AI_FEATURES_ENABLED !== 'false';
