import React, { forwardRef } from 'react';
import { HostType, svgQueries, type HostNode } from '@mimicry/engine';
import { getEngine } from '../engine-ref';
import { registerNativeComponents, registerNativeModules, warnOnce, type NativeComponentImpl } from './registry';

/**
 * The native side of react-native-svg. Apps run the library's own
 * JavaScript; its native components become engine nodes: the SVG viewport is
 * an `m-svg` box in layout, every element inside it an `m-svg-node` that the
 * engine paints as vector geometry (packages/engine/src/svg).
 */
const h = React.createElement as (...args: any[]) => React.ReactElement;

function element(svgType: string): NativeComponentImpl {
  const Element = forwardRef<HostNode, Record<string, unknown>>(function SvgElement(props, ref) {
    return h(HostType.SvgNode, { ...props, svgType, ref });
  });
  Element.displayName = `RNSVG(${svgType})`;
  return Element;
}

const SvgView = forwardRef<HostNode, Record<string, unknown>>(function SvgView(props, ref) {
  return h(HostType.Svg, { ...props, ref });
});

const ELEMENTS: Record<string, string> = {
  RNSVGGroup: 'g',
  RNSVGPath: 'path',
  RNSVGRect: 'rect',
  RNSVGCircle: 'circle',
  RNSVGEllipse: 'ellipse',
  RNSVGLine: 'line',
  RNSVGText: 'text',
  RNSVGTSpan: 'tspan',
  RNSVGTextPath: 'textPath',
  RNSVGImage: 'image',
  RNSVGUse: 'use',
  RNSVGSymbol: 'symbol',
  RNSVGDefs: 'defs',
  RNSVGClipPath: 'clipPath',
  RNSVGMask: 'mask',
  RNSVGPattern: 'pattern',
  RNSVGMarker: 'marker',
  RNSVGLinearGradient: 'linearGradient',
  RNSVGRadialGradient: 'radialGradient',
  RNSVGForeignObject: 'foreignObject',
  RNSVGFilter: 'filter',
  RNSVGFeBlend: 'feBlend',
  RNSVGFeColorMatrix: 'feColorMatrix',
  RNSVGFeComposite: 'feComposite',
  RNSVGFeFlood: 'feFlood',
  RNSVGFeGaussianBlur: 'feGaussianBlur',
  RNSVGFeMerge: 'feMerge',
  RNSVGFeOffset: 'feOffset',
};

registerNativeComponents({
  RNSVGSvgView: SvgView,
  RNSVGSvgViewAndroid: SvgView,
  ...Object.fromEntries(Object.entries(ELEMENTS).map(([name, type]) => [name, element(type)])),
});

/** A native tag (findNodeHandle) → the engine node, if it is an SVG element. */
function svgNode(tag: unknown): HostNode | null {
  const node = typeof tag === 'number' ? getEngine().nodes.get(tag) : null;
  return node && node.kind === 'svg-node' ? node : null;
}

const point = (options: unknown) => {
  const o = (options ?? {}) as { x?: number; y?: number };
  return [Number(o.x) || 0, Number(o.y) || 0] as const;
};

const matrixObject = (m: number[] | null) => (m ? { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] } : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

registerNativeModules({
  RNSVGRenderableModule: () => ({
    isPointInFill: (tag: number, options?: object) => {
      const node = svgNode(tag);
      return node ? svgQueries.isPointInFill(getEngine(), node, ...point(options)) : false;
    },
    isPointInStroke: (tag: number, options?: object) => {
      const node = svgNode(tag);
      return node ? svgQueries.isPointInStroke(getEngine(), node, ...point(options)) : false;
    },
    getTotalLength: (tag: number) => {
      const node = svgNode(tag);
      return node ? svgQueries.totalLength(getEngine(), node) : 0;
    },
    getPointAtLength: (tag: number, options?: { length?: number }) => {
      const node = svgNode(tag);
      return node ? svgQueries.pointAtLength(getEngine(), node, Number(options?.length) || 0) : { x: 0, y: 0, angle: 0 };
    },
    getBBox: (tag: number) => {
      const node = svgNode(tag);
      const r = node ? svgQueries.bbox(getEngine(), node) : null;
      return r ? { x: r.x, y: r.y, width: r.w, height: r.h } : { x: 0, y: 0, width: 0, height: 0 };
    },
    getCTM: (tag: number) => {
      const node = svgNode(tag);
      return matrixObject(node ? svgQueries.ctm(getEngine(), node) : null);
    },
    getScreenCTM: (tag: number) => {
      const node = svgNode(tag);
      return matrixObject(node ? svgQueries.screenCTM(getEngine(), node) : null);
    },
    getRawResource: async (name: string) => {
      throw new Error(`react-native-svg getRawResource('${name}') reads native app resources, which Mimicry does not have.`);
    },
  }),
  RNSVGSvgViewModule: () => ({
    toDataURL: (_tag: number, _options?: object, callback?: (base64: string) => void) => {
      // Rasterizing happens on the host; the engine cannot produce pixels synchronously.
      warnOnce('svg:toDataURL', 'Svg.toDataURL() is not supported by Mimicry; the callback receives an empty string.');
      callback?.('');
    },
  }),
});
