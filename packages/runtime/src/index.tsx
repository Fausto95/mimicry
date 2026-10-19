/**
 * Mimicry's browser equivalents of a small, documented subset of Expo UI.
 * The native Expo targets continue using @expo/ui. Metro maps these imports
 * only when compiling for the web target.
 *
 * These are approximations informed by UIKit/SwiftUI/Material3, NOT Apple/
 * Google's frameworks compiled to Wasm. Unimplemented exports fail loudly.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text as RNText, TextInput as RNTextInput, View } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';

type Platform = 'ios' | 'android';
type Appearance = 'light' | 'dark';
interface Environment { platform: Platform; appearance: Appearance; }
const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
let environment: Environment = {
  platform: query?.get('mimicry-platform') === 'android' ? 'android' : 'ios',
  appearance: query?.get('mimicry-theme') === 'dark' ? 'dark' : 'light'
};
const subscribers = new Set<() => void>();
const snapshot = () => environment;
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
const expectedParentOrigin = query?.get('parentOrigin') || '';
function report(type: string, payload: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || !expectedParentOrigin || window.parent === window) return;
  window.parent.postMessage({ source: 'mimicry:app', type, ...payload }, expectedParentOrigin);
}
function update(next: Partial<Environment>) {
  const platform = next.platform === 'android' ? 'android' : next.platform === 'ios' ? 'ios' : environment.platform;
  const appearance = next.appearance === 'dark' ? 'dark' : next.appearance === 'light' ? 'light' : environment.appearance;
  if (platform === environment.platform && appearance === environment.appearance) return;
  environment = { platform, appearance };
  subscribers.forEach((fn) => fn());
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (!expectedParentOrigin || event.origin !== expectedParentOrigin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== 'mimicry:studio' || data.type !== 'environment') return;
    update({ platform:data.platform, appearance:data.appearance });
  });
  if (expectedParentOrigin) {
    // Expo bundles can load slowly. Signal after the app's initial JS executes.
    setTimeout(() => report('ready', { capabilities: Object.keys(capabilities), environment }), 0);
  }
}
export function useMimicryEnvironment(): Environment {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
function isDark(e: Environment) { return e.appearance === 'dark'; }
function palette(e: Environment) {
  const dark = isDark(e);
  const apple = e.platform === 'ios';
  return {
    primary: apple ? '#007AFF' : '#6750A4',
    onPrimary: '#fff',
    surface: dark ? (apple ? '#2C2C2E' : '#292A2E') : (apple ? '#F2F2F7' : '#F3EDF7'),
    container: dark ? '#26262C' : '#FFFFFF',
    text: dark ? '#F8F8F8' : '#202027',
    outline: dark ? '#85848C' : '#79747E',
    muted: dark ? '#ACACB6' : '#6C6C75',
    track: dark ? '#52525A' : '#E9E9EA',
    radius: apple ? 11 : 28
  };
}
const container = (style?: ViewStyle) => ({ display: 'flex' as const, ...style });
type ElementProps = { children?: React.ReactNode; style?: ViewStyle; [key: string]: any };
export function Host({ children, style, matchContents, ...rest }: ElementProps & { matchContents?: unknown }) {
  const e = useMimicryEnvironment();
  useEffect(() => { report('mount', { component:'Host', platform:e.platform }); }, [e.platform]);
  return <View style={[{ width: '100%', flexShrink: 0 }, style]} {...rest}>{children}</View>;
}
export function Column({ children, spacing = 8, alignment, style }: ElementProps & { spacing?: number; alignment?: string }) {
  return <View style={[container({ flexDirection:'column', gap:spacing, alignItems: alignment === 'center' ? 'center' : 'stretch' }), style]}>{children}</View>;
}
export function Row({ children, spacing = 8, alignment, style }: ElementProps & { spacing?: number; alignment?: string }) {
  return <View style={[container({ flexDirection:'row', gap:spacing, alignItems: alignment === 'center' ? 'center' : 'stretch' }), style]}>{children}</View>;
}
export function Text({ children, textStyle, style, ...rest }: { children?: React.ReactNode; textStyle?: TextStyle; style?: TextStyle; [key:string]:any }) {
  const e = useMimicryEnvironment();
  return <RNText style={[{ color:palette(e).text, fontSize:15 }, textStyle, style]} {...rest}>{children}</RNText>;
}
export function Spacer({ minLength = 0 }: { minLength?: number }) {
  return <View style={{ minHeight:minLength, flexGrow:1 }}/>;
}
export function Button({ label, children, onPress, disabled, variant, ...rest }: { label?: string; children?: React.ReactNode; onPress?: () => void; disabled?: boolean; variant?: string; [key:string]:any }) {
  const e = useMimicryEnvironment();
  const p = palette(e);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled:!!disabled }} disabled={disabled} onPress={() => {
    report('interaction', { component:'Button', action:'press', label:label || String(children || '') });
    onPress?.();
  }} style={({pressed}) => ({
    backgroundColor: variant === 'plain' ? 'transparent' : p.primary, borderRadius:p.radius,
    minHeight:e.platform === 'ios' ? 38 : 40, paddingVertical:8, paddingHorizontal:16,
    justifyContent:'center', alignItems:'center', opacity:disabled ? .4 : pressed ? .8 : 1
  })} {...rest}>
    <RNText style={{ fontSize:14, fontWeight:'600', color:variant === 'plain' ? p.primary : p.onPrimary }}>{label || children}</RNText>
  </Pressable>;
}
export function Switch({ label, value = false, disabled = false, onValueChange, ...rest }: {
  label?: string; value?: boolean; disabled?: boolean; onValueChange?: (v:boolean) => void; [key:string]:any;
}) {
  const e = useMimicryEnvironment();
  const p = palette(e);
  const ios = e.platform === 'ios';
  return <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', minHeight:40, gap:12 }}>
    {!!label && <RNText style={{ flex:1, color:p.text, fontSize:ios ? 16 : 14 }}>{label}</RNText>}
    <Pressable {...rest} accessibilityLabel={label || 'Toggle'} accessibilityRole="switch"
      accessibilityState={{ checked:value, disabled }} disabled={disabled}
      onPress={() => { report('interaction', { component:'Switch', value:!value }); onValueChange?.(!value); }}
      style={{
        width:ios ? 51 : 52, height:ios ? 31 : 32, borderRadius:99, padding:ios ? 2 : 4,
        backgroundColor:value ? p.primary : p.track,
        borderWidth:!ios && !value ? 2 : 0, borderColor:p.outline,
        flexDirection:'row', alignItems:'center', justifyContent:value ? 'flex-end' : 'flex-start',
        opacity:disabled ? .5 : 1
      }}>
      <View style={{
        width: ios ? 27 : (value ? 24 : 16), height:ios ? 27 : (value ? 24 : 16),
        borderRadius:99, backgroundColor:ios ? '#FFFFFF' : value ? '#FFFFFF' : p.outline,
        ...(ios ? { shadowColor:'#000', shadowOpacity:.15, shadowOffset:{width:0,height:1}, shadowRadius:2 } : {})
      }}/>
    </Pressable>
  </View>;
}
export function Slider({ value = 0, onValueChange, min = 0, max = 1, step = .01, disabled = false, ...rest }: {
  value?:number; min?:number; max?:number; step?:number; disabled?:boolean; onValueChange?: (v:number)=>void; [key:string]:any;
}) {
  const e = useMimicryEnvironment();
  const p = palette(e);
  // A semantic browser input is used so keyboard, pointer and assistive input work.
  return <View style={{ minHeight:40, justifyContent:'center' }}>
    <input type="range" className={'mimicry-slider mimicry-slider-'+e.platform} min={min} max={max} step={step}
      value={value} disabled={disabled} aria-label="Slider"
      onChange={(ev) => { const next=Number(ev.currentTarget.value); report('interaction',{component:'Slider',value:next}); onValueChange?.(next); }}
      style={{ width:'100%', accentColor:p.primary, cursor:'pointer' }} {...rest}/>
  </View>;
}
export function Checkbox({ label, value = false, onValueChange, disabled = false }: { label?:string; value?:boolean; onValueChange?:(value:boolean)=>void; disabled?:boolean }) {
  const e=useMimicryEnvironment(), p=palette(e);
  return <Pressable disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked:value, disabled }}
    onPress={() => { report('interaction',{component:'Checkbox',value:!value}); onValueChange?.(!value); }}
    style={{flexDirection:'row',alignItems:'center',gap:10,opacity:disabled?.5:1}}>
    <View style={{width:22,height:22,borderRadius:e.platform==='ios'?6:3,borderColor:p.primary,borderWidth:2,backgroundColor:value?p.primary:'transparent',alignItems:'center',justifyContent:'center'}}>
      {value && <RNText style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>✓</RNText>}
    </View>
    {!!label && <RNText style={{color:p.text}}>{label}</RNText>}
  </Pressable>;
}
export function TextInput({ value, onChangeText, placeholder, ...rest }: {
  value?:string; onChangeText?:(value:string)=>void; placeholder?:string; [key:string]:any
}) {
  const e=useMimicryEnvironment(), p=palette(e);
  return <RNTextInput
    value={value} placeholder={placeholder} onChangeText={onChangeText} placeholderTextColor={p.muted}
    style={{borderRadius:e.platform==='ios'?9:5,backgroundColor:p.surface,color:p.text,fontSize:15,padding:12,minHeight:42}}
    {...rest}/>;
}
export function FieldGroup({ children }: { children?:React.ReactNode }) {
  const e=useMimicryEnvironment(), p=palette(e);
  return <View style={{backgroundColor:p.container,borderRadius:e.platform==='ios'?12:22,padding:16,gap:14}}>{children}</View>;
}
export function List({ children }: { children?:React.ReactNode }) { return <Column spacing={1}>{children}</Column>; }
export function Icon({ name, size = 20 }: { name:string; size?:number }) {
  const e=useMimicryEnvironment();
  const icons:Record<string,string>={checkmark:'✓',gear:'⚙',heart:'♥',star:'★',plus:'+',minus:'−',chevron:'›'};
  return <RNText accessibilityLabel={name} style={{fontSize:size,color:palette(e).primary}}>{icons[name]||'◇'}</RNText>;
}
export function Collapsible({ children, title }: { children?:React.ReactNode; title?:string }) {
  const [open,setOpen]=useState(false);
  return <View><Button label={title||'Show details'} variant="plain" onPress={()=>setOpen(!open)}/>{open && children}</View>;
}
// Deliberately only expose capabilities with working implementations.
export const capabilities = Object.freeze({
  Host:'approximate', Column:'approximate', Row:'approximate', Text:'approximate',
  Spacer:'approximate', Button:'approximate', Switch:'approximate',
  Slider:'approximate', Checkbox:'approximate', TextInput:'approximate',
  FieldGroup:'approximate', List:'approximate', Icon:'approximate', Collapsible:'approximate'
});
