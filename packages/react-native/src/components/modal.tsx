import React, { useEffect, useState } from 'react';
import { HostType } from '@mimicry/engine';
import { View } from './primitives';

const h = React.createElement as (...args: any[]) => React.ReactElement;

/**
 * Modal. The host node is laid out against the window and presented by the
 * engine (slide / fade / iOS page sheet). It stays mounted while the dismiss
 * animation runs, then unmounts after `onDismiss`.
 */
export function Modal(props: Record<string, any>) {
  const { visible = true, children, transparent, onDismiss, animationType = 'none', ...rest } = props;
  const [rendered, setRendered] = useState(visible);
  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);
  if (!visible && !rendered) return null;
  const dismissed = () => {
    if (!visible) setRendered(false);
    onDismiss?.();
  };
  return h(
    HostType.Modal,
    { ...rest, visible, transparent: !!transparent, animationType, onDismiss: dismissed },
    h(View, { style: { flex: 1, backgroundColor: transparent ? 'transparent' : 'white' }, children }),
  );
}
