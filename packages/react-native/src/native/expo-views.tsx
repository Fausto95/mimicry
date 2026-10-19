import React, { forwardRef } from 'react';
import { HostType } from '@mimicry/react-native-fabric';
import { Text, View } from '../components/primitives';
import { registerNativeComponents } from './registry';

/**
 * Native views of Expo SDK packages whose JavaScript renders them:
 * expo-image's ExpoImage and expo-symbols' SymbolModule (iOS).
 */

// ── expo-image ─────────────────────────────────────────────────────────

const CONTENT_FIT: Record<string, string> = { cover: 'cover', contain: 'contain', fill: 'stretch', none: 'center', 'scale-down': 'contain' };

type Source = { uri?: string; width?: number; height?: number; scale?: number };

/** expo-image picks the source whose size best fits the view; prefer the largest otherwise. */
function pickSource(sources: Source[] | Source | null | undefined): Source | null {
  if (!sources) return null;
  const list = (Array.isArray(sources) ? sources : [sources]).filter((s) => s && s.uri);
  if (!list.length) return null;
  return list.reduce((best, s) => ((s.width ?? 0) * (s.scale ?? 1) > (best.width ?? 0) * (best.scale ?? 1) ? s : best));
}

const ExpoImage = forwardRef<any, any>(function ExpoImage(props, ref) {
  const { source, placeholder, contentFit, style, tintColor, onLoad, onLoadStart, onError, accessibilityLabel, testID, children } = props;
  const chosen = pickSource(source) ?? pickSource(placeholder);
  return React.createElement(HostType.Image, {
    ref,
    testID,
    accessibilityLabel,
    source: chosen ? { uri: chosen.uri, width: chosen.width, height: chosen.height } : undefined,
    resizeMode: CONTENT_FIT[contentFit ?? 'cover'] ?? 'cover',
    tintColor: tintColor ?? undefined,
    style,
    onLoadStart: () => onLoadStart?.({ nativeEvent: {} }),
    onLoad: (e: any) => {
      const s = e?.nativeEvent?.source ?? {};
      onLoad?.({ nativeEvent: { cacheType: 'none', source: { url: s.uri, width: s.width, height: s.height, mediaType: null, isAnimated: false } } });
    },
    onError: (e: any) => onError?.({ nativeEvent: { error: e?.nativeEvent?.error ?? 'failed to load' } }),
    children,
  });
});

// ── expo-symbols (iOS) ─────────────────────────────────────────────────

/**
 * SF Symbols can't be redistributed, so iOS symbols are drawn with Google's
 * Material Symbols (bundled, Apache 2.0) using the closest equivalent glyph.
 * Unknown names fall back to a name-based guess (`star.fill` → `star`).
 */
const SF_TO_MATERIAL: Record<string, string> = {
  'chevron.right': 'chevron_right', 'chevron.left': 'chevron_left', 'chevron.up': 'expand_less', 'chevron.down': 'expand_more',
  'chevron.forward': 'chevron_right', 'chevron.backward': 'chevron_left',
  'arrow.up.right.square': 'open_in_new', 'arrow.up.right': 'north_east', 'arrow.left': 'arrow_back', 'arrow.right': 'arrow_forward',
  'arrow.up': 'arrow_upward', 'arrow.down': 'arrow_downward', 'arrow.clockwise': 'refresh', 'arrow.counterclockwise': 'undo',
  'arrow.triangle.2.circlepath': 'sync', 'square.and.arrow.up': 'ios_share', 'square.and.arrow.down': 'download',
  house: 'home', 'house.fill': 'home', gear: 'settings', gearshape: 'settings', 'gearshape.fill': 'settings',
  magnifyingglass: 'search', 'person': 'person', 'person.fill': 'person', 'person.circle': 'account_circle', 'person.crop.circle': 'account_circle',
  'person.2': 'group', 'bell': 'notifications', 'bell.fill': 'notifications', heart: 'favorite', 'heart.fill': 'favorite',
  star: 'star', 'star.fill': 'star', bookmark: 'bookmark', 'bookmark.fill': 'bookmark', trash: 'delete', 'trash.fill': 'delete',
  pencil: 'edit', 'square.and.pencil': 'edit_square', plus: 'add', 'plus.circle': 'add_circle', 'plus.circle.fill': 'add_circle',
  minus: 'remove', xmark: 'close', 'xmark.circle': 'cancel', 'xmark.circle.fill': 'cancel', checkmark: 'check',
  'checkmark.circle': 'check_circle', 'checkmark.circle.fill': 'check_circle', 'info.circle': 'info', 'exclamationmark.triangle': 'warning',
  'questionmark.circle': 'help', ellipsis: 'more_horiz', 'ellipsis.circle': 'more_horiz', 'line.3.horizontal': 'menu',
  'list.bullet': 'list', 'square.grid.2x2': 'grid_view', calendar: 'calendar_today', clock: 'schedule', 'envelope': 'mail',
  'envelope.fill': 'mail', 'paperplane': 'send', 'paperplane.fill': 'send', 'message': 'chat_bubble', 'bubble.left': 'chat_bubble',
  phone: 'call', 'phone.fill': 'call', camera: 'photo_camera', 'camera.fill': 'photo_camera', photo: 'image', 'photo.fill': 'image',
  'play.fill': 'play_arrow', play: 'play_arrow', 'pause.fill': 'pause', 'stop.fill': 'stop', 'forward.fill': 'fast_forward',
  'backward.fill': 'fast_rewind', 'speaker.wave.2': 'volume_up', 'speaker.slash': 'volume_off', mic: 'mic', 'mic.fill': 'mic',
  lock: 'lock', 'lock.fill': 'lock', 'lock.open': 'lock_open', eye: 'visibility', 'eye.slash': 'visibility_off', link: 'link',
  globe: 'language', map: 'map', 'mappin': 'location_on', 'location': 'near_me', 'cart': 'shopping_cart', 'bag': 'shopping_bag',
  'creditcard': 'credit_card', 'doc': 'description', 'doc.text': 'description', folder: 'folder', 'folder.fill': 'folder',
  'tray': 'inbox', 'tray.fill': 'inbox', 'paperclip': 'attach_file', 'cloud': 'cloud', 'sun.max': 'light_mode', 'moon': 'dark_mode',
  'bolt': 'bolt', 'flame': 'local_fire_department', 'leaf': 'eco', 'wifi': 'wifi', 'battery.100': 'battery_full',
  'chart.bar': 'bar_chart', 'slider.horizontal.3': 'tune', 'line.3.horizontal.decrease': 'filter_list', 'qrcode': 'qr_code',
  'hand.thumbsup': 'thumb_up', 'hand.thumbsdown': 'thumb_down', 'flag': 'flag', 'tag': 'sell', 'gift': 'redeem', 'cup.and.saucer': 'local_cafe',
  'car': 'directions_car', 'airplane': 'flight', 'bicycle': 'pedal_bike', 'figure.walk': 'directions_walk', 'music.note': 'music_note',
  'film': 'movie', 'tv': 'tv', 'gamecontroller': 'sports_esports', 'book': 'menu_book', 'graduationcap': 'school', 'briefcase': 'work',
  'building.2': 'apartment', 'square.stack': 'layers', 'rectangle.portrait.and.arrow.right': 'logout', 'power': 'power_settings_new',
};

export function materialNameFor(sfName: string): string {
  const known = SF_TO_MATERIAL[sfName] ?? SF_TO_MATERIAL[sfName.replace(/\.fill$/, '')];
  if (known) return known;
  return sfName.replace(/\.(fill|circle|square)$/g, '').replace(/\./g, '_');
}

const WEIGHT: Record<string, string> = { ultraLight: '100', thin: '200', light: '300', regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800', black: '900' };

const SymbolView = forwardRef<any, any>(function SymbolView(props, ref) {
  const { name, style, tint, colors, weight } = props;
  const size = (StyleSize(style) ?? 24);
  const color = tint ?? colors?.[0] ?? '#007aff';
  return React.createElement(View, { ref, style: [style, { alignItems: 'center', justifyContent: 'center' }], pointerEvents: 'none' },
    React.createElement(Text, {
      accessible: false,
      allowFontScaling: false,
      style: { fontFamily: 'Material Symbols', fontSize: size, lineHeight: size, color, fontWeight: WEIGHT[weight] ?? '400' },
    }, materialNameFor(String(name ?? ''))));
});

function StyleSize(style: unknown): number | undefined {
  const list = Array.isArray(style) ? style.flat(Infinity as 1) : [style];
  let size: number | undefined;
  for (const s of list) if (s && typeof s === 'object' && typeof (s as any).width === 'number') size = (s as any).width;
  return size;
}

registerNativeComponents({ ExpoImage, SymbolModule: SymbolView });
