/**
 * SF Symbols → Material Symbols. SF Symbols can't be redistributed, so
 * UIImage(systemName:) draws Google's Material Symbols (bundled, Apache 2.0)
 * glyph closest to each symbol, by its ligature name. Unknown names fall
 * back to a name-based guess (`star.fill` → `star`); filled and outlined
 * variants share a glyph. (Same table as React Native's expo-symbols view.)
 */
export const SF_TO_MATERIAL: Record<string, string> = {
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
  // UIKit's own system items
  'arrowshape.turn.up.left': 'reply', 'arrow.uturn.backward': 'undo', 'arrow.uturn.forward': 'redo', 'apple.writing.tools': 'edit_note',
  'clock.arrow.circlepath': 'history', 'star.circle': 'stars', 'person.2.fill': 'group', 'square.grid.2x2.fill': 'grid_view',
  'arrow.down.circle': 'download', 'list.number': 'format_list_numbered', 'ellipsis.circle.fill': 'more_horiz',
};

/** The Material Symbols ligature that draws an SF Symbol. */
export function materialNameFor(sfName: string): string {
  const known = SF_TO_MATERIAL[sfName] ?? SF_TO_MATERIAL[sfName.replace(/\.fill$/, '')];
  if (known) return known;
  return sfName.replace(/\.(fill|circle|square)$/g, '').replace(/\./g, '_');
}

/** The font family the glyphs come from. */
export const SYMBOL_FONT_FAMILY = 'Material Symbols';
