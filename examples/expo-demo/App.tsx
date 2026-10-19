import { useEffect, useMemo, useState } from 'react';
import {
  Platform, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import { Host, Column, Switch, Slider, Button } from '@expo/ui';

type DevicePlatform = 'ios' | 'android';
type Appearance = 'light' | 'dark';
function previewSettings() {
  if (Platform.OS !== 'web' || typeof window === 'undefined')
    return { platform:Platform.OS === 'android' ? 'android' as const : 'ios' as const, appearance:'light' as const };
  const params=new URLSearchParams(window.location.search);
  return {
    platform:params.get('mimicry-platform') === 'android' ? 'android' as const : 'ios' as const,
    appearance:params.get('mimicry-theme') === 'dark' ? 'dark' as const : 'light' as const
  };
}
function usePreview() {
  const [data,setData]=useState<{platform:DevicePlatform;appearance:Appearance}>(previewSettings);
  useEffect(() => {
    if (typeof window === 'undefined' || Platform.OS !== 'web') return;
    const params=new URLSearchParams(window.location.search), parentOrigin=params.get('parentOrigin');
    const receive=(event:MessageEvent) => {
      if (!parentOrigin || event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.source !== 'mimicry:studio' || event.data?.type !== 'environment') return;
      setData({platform:event.data.platform==='android'?'android':'ios',appearance:event.data.appearance==='dark'?'dark':'light'});
    };
    window.addEventListener('message',receive);
    return () => window.removeEventListener('message',receive);
  },[]);
  return data;
}
function Pill({ label, selected, onPress, dark }:{
  label:string;selected:boolean;onPress:()=>void;dark:boolean
}) {
  return <Pressable onPress={onPress} style={[styles.pill,{backgroundColor:selected?'#6576fa':dark?'#313548':'#e9edf6'}]}>
    <Text style={{color:selected?'white':dark?'#d9dcf8':'#5f687c',fontWeight:'700',fontSize:12}}>{label}</Text>
  </Pressable>;
}
export default function App() {
  const {platform,appearance}=usePreview();
  const dark=appearance==='dark';
  const android=platform==='android';
  const [page,setPage]=useState<'discover'|'controls'>('discover');
  const [count,setCount]=useState(12);
  const [notifications,setNotifications]=useState(true);
  const [value,setValue]=useState(0.42);
  const [name,setName]=useState('');
  const [selected,setSelected]=useState('Design');
  const [showSheet,setShowSheet]=useState(false);
  const colors=useMemo(()=>({
    background:dark?'#10131c':'#f6f8fc',
    card:dark?'#1d2431':'#ffffff',
    text:dark?'#f4f6fd':'#1a253a',
    muted:dark?'#9da9bb':'#7a8699',
    border:dark?'#30394a':'#e5eaf3'
  }),[dark]);
  const onCard=(label:string)=>setSelected(label);
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}>
    <ScrollView contentContainerStyle={{paddingBottom:30}}>
      <View style={styles.header}>
        <View style={styles.logo}><Text style={{color:'#fff',fontSize:19,fontWeight:'900'}}>m</Text></View>
        <View style={{flex:1}}>
          <Text style={{fontSize:15,fontWeight:'800',color:colors.text}}>mimicry lab</Text>
          <Text style={{fontSize:9,letterSpacing:1.4,color:colors.muted,fontWeight:'800'}}>EXPO SDK 58 · BROWSER RUNTIME</Text>
        </View>
        <View style={[styles.badge,{backgroundColor:dark?'#173d31':'#e5f6ee'}]}>
          <View style={{width:6,height:6,borderRadius:3,backgroundColor:'#2cc98b'}}/>
          <Text style={{fontSize:9,color:dark?'#82e3bc':'#168e61',fontWeight:'800'}}>LIVE</Text>
        </View>
      </View>
      <View style={{paddingHorizontal:23,paddingTop:29}}>
        <Text style={{color:'#697cf8',fontSize:10,fontWeight:'800',letterSpacing:1.7}}>0{page==='discover'?1:2} / {android?'ANDROID':'IOS'} PREVIEW</Text>
        <Text style={{fontWeight:'800',color:colors.text,fontSize:39,lineHeight:44,letterSpacing:-1.8,marginTop:12}}>
          {page==='discover'?'Designed to\nfeel native.':'The native\ncomponent lab.'}
        </Text>
        <Text style={{fontSize:13,lineHeight:21,color:colors.muted,marginTop:12,marginBottom:24}}>
          {page==='discover'
            ? 'One real Expo application, running entirely in your browser. Mimicry emulates platform appearance and interactions.'
            : 'These Expo UI components are browser-side approximations of '+(android?'Material 3 and Compose.':'SwiftUI and UIKit.') }
        </Text>
        {page==='discover'?<>
          <View style={[styles.feature,{backgroundColor:android?'#403461':'#23325a'}]}>
            <View style={styles.featureHeader}><Text style={styles.featureLabel}>MIMICRY RENDER TARGET</Text><Text style={{fontSize:18,color:'#aab8ff'}}>✦</Text></View>
            <Text style={{fontSize:24,color:'#fff',fontWeight:'800',letterSpacing:-.7}}>{android?'Material 3':'Cupertino'}</Text>
            <Text style={{fontSize:12,color:'#c1cbeb',lineHeight:19,marginTop:9}}>
              {android?'Compose-inspired elevation, shapes and controls.':'SwiftUI-inspired controls, motion and system colors.'}
            </Text>
            <View style={{height:1,backgroundColor:'#ffffff25',marginVertical:20}}/>
            <View style={{flexDirection:'row',justifyContent:'space-between'}}>
              <Text style={{color:'#b6c1e0',fontSize:11}}>Execution</Text>
              <Text style={{color:'#fff',fontSize:11,fontWeight:'700'}}>Expo Metro + React Native Web</Text>
            </View>
          </View>
          <Text style={[styles.sectionEyebrow,{marginTop:31}]}>01 / REAL APP STATE</Text>
          <Text style={[styles.sectionTitle,{color:colors.text}]}>Tap, update, repeat</Text>
          <View style={[styles.counter,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <View>
              <Text style={[styles.fieldLabel,{color:colors.muted}]}>STATE COUNTER</Text>
              <Text style={{fontSize:36,fontWeight:'800',color:colors.text,marginTop:4}}>{count}</Text>
            </View>
            <View style={{flexDirection:'row',gap:9}}>
              <Pressable accessibilityLabel="Decrease count" onPress={()=>setCount(c=>c-1)} style={[styles.square,{backgroundColor:dark?'#30384b':'#edf0f7'}]}>
                <Text style={{fontSize:25,color:colors.text}}>−</Text>
              </Pressable>
              <Pressable accessibilityLabel="Increase count" onPress={()=>setCount(c=>c+1)} style={[styles.square,{backgroundColor:'#6577f8'}]}>
                <Text style={{fontSize:25,color:'#fff'}}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.card,{backgroundColor:colors.card,borderColor:colors.border,marginTop:12}]}>
            <Text style={[styles.fieldLabel,{color:colors.muted}]}>NATIVE-LIKE TEXT INPUT</Text>
            <TextInput value={name} onChangeText={setName} placeholder="What's your name?" placeholderTextColor={colors.muted}
              style={[styles.input,{color:colors.text,borderColor:colors.border,backgroundColor:colors.background}]}/>
            <Text style={{fontSize:11,color:colors.muted,marginTop:12}}>Hello{name?', '+name:''}! Try typing and selecting text.</Text>
          </View>
          <Text style={[styles.sectionEyebrow,{marginTop:30}]}>02 / LIVE FILTERING</Text>
          <View style={{flexDirection:'row',gap:9,marginTop:12,marginBottom:14}}>
            {['Design','Build','Ship'].map((item)=><Pill key={item} label={item} selected={selected===item} dark={dark} onPress={()=>onCard(item)}/>)}
          </View>
          <View style={[styles.card,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <Text style={{color:colors.text,fontSize:15,fontWeight:'800'}}>{selected} something great</Text>
            <Text style={{color:colors.muted,fontSize:12,marginTop:8}}>A stateful React Native component in the same Expo source used on iOS and Android.</Text>
          </View>
        </>:<>
          <Text style={styles.sectionEyebrow}>01 / EXPO UI EMULATION</Text>
          <View style={[styles.card,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <Text style={[styles.fieldLabel,{color:colors.muted}]}>{android?'COMPOSE':'SWIFTUI'} / COMPONENT REGISTRY</Text>
            <Host matchContents={{ vertical: true }} style={{width:'100%'}}>
              <Column spacing={21}>
                <Switch label="Push notifications" value={notifications} onValueChange={setNotifications}/>
                <Slider value={value} onValueChange={setValue} min={0} max={1} step={0.01}/>
                <Button label={'Tap the '+(android?'Material':'Cupertino')+' button'} onPress={()=>setCount(c=>c+1)}/>
              </Column>
            </Host>
            <Text style={{color:colors.muted,fontSize:11,marginTop:21}}>Notifications {notifications?'on':'off'} · Progress {Math.round(value*100)}% · Count {count}</Text>
          </View>
          <Text style={[styles.sectionEyebrow,{marginTop:25}]}>02 / PRESENTATION</Text>
          <Pressable style={[styles.card,{backgroundColor:colors.card,borderColor:colors.border,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}]}
            onPress={()=>setShowSheet(true)}>
            <View><Text style={{fontWeight:'800',fontSize:15,color:colors.text}}>Present a system sheet</Text><Text style={{fontSize:11,marginTop:5,color:colors.muted}}>Simulated modal presentation</Text></View>
            <Text style={{fontSize:25,color:'#697cf8'}}>›</Text>
          </Pressable>
        </>}
      </View>
    </ScrollView>
    <View style={{flexDirection:'row',gap:8,padding:13,paddingHorizontal:22,backgroundColor:colors.card,borderTopWidth:1,borderColor:colors.border}}>
      {(['discover','controls'] as const).map((tab)=><Pressable key={tab} onPress={()=>setPage(tab)}
        style={{flex:1,alignItems:'center',paddingVertical:13,borderRadius:11,backgroundColor:page===tab?(dark?'#343b61':'#edf0ff'):'transparent'}}>
        <Text style={{fontWeight:'800',fontSize:12,color:page===tab?'#697cf8':colors.muted}}>{tab==='discover'?'◈  Discover':'⚙  Native UI'}</Text>
      </Pressable>)}
    </View>
    {showSheet && <View style={styles.modalMask}>
      <Pressable style={{flex:1}} onPress={()=>setShowSheet(false)}/>
      <View style={{backgroundColor:colors.card,borderTopLeftRadius:android?28:22,borderTopRightRadius:android?28:22,padding:24,paddingBottom:40}}>
        <View style={{alignSelf:'center',width:38,height:5,borderRadius:10,backgroundColor:colors.muted,marginBottom:20}}/>
        <Text style={{fontSize:22,fontWeight:'800',color:colors.text}}>Hello from {android?'Android':'iOS'}</Text>
        <Text style={{color:colors.muted,marginTop:12,marginBottom:23,lineHeight:20}}>This sheet is a browser approximation. Native modal behavior remains a fidelity target.</Text>
        <Pressable onPress={()=>setShowSheet(false)} style={{padding:15,borderRadius:android?25:11,backgroundColor:'#697cf8',alignItems:'center'}}>
          <Text style={{color:'white',fontWeight:'700'}}>Done</Text>
        </Pressable>
      </View>
    </View>}
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  header:{height:76,paddingHorizontal:23,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:1,borderColor:'#80809015'},
  logo:{width:36,height:36,borderRadius:10,backgroundColor:'#6374fa',alignItems:'center',justifyContent:'center'},
  badge:{paddingVertical:7,paddingHorizontal:9,borderRadius:8,flexDirection:'row',alignItems:'center',gap:6},
  feature:{borderRadius:21,padding:23},
  featureHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10},
  featureLabel:{color:'#a2b0e0',fontSize:9,fontWeight:'900',letterSpacing:1.4},
  sectionEyebrow:{color:'#7786ec',fontSize:10,letterSpacing:1.2,fontWeight:'800'},
  sectionTitle:{fontSize:20,fontWeight:'800',marginTop:8,marginBottom:17},
  counter:{padding:20,borderWidth:1,borderRadius:17,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  fieldLabel:{fontSize:9,fontWeight:'800',letterSpacing:1.2},
  square:{width:45,height:45,borderRadius:13,alignItems:'center',justifyContent:'center'},
  card:{padding:20,borderWidth:1,borderRadius:17},
  input:{borderWidth:1,borderRadius:10,padding:12,fontSize:14,marginTop:12},
  pill:{paddingHorizontal:17,paddingVertical:12,borderRadius:10},
  modalMask:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'#0008',justifyContent:'flex-end'}
});
