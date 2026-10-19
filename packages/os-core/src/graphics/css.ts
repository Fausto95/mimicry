/**
 * A flattened CSS-like style object (camelCase properties). The box painter
 * reads backgrounds, borders, radii and shadows from it; React Native, Lynx
 * and Vector styles all flatten to this shape.
 */
export type CSSStyle = Readonly<Record<string, any>>;
