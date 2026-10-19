declare module 'react-refresh/runtime' {
  const RefreshRuntime: {
    injectIntoGlobalHook(globalObject: unknown): void;
    register(type: unknown, id: string): void;
    createSignatureFunctionForTransform(): unknown;
    isLikelyComponentType(value: unknown): boolean;
    performReactRefresh(): unknown;
  };
  export default RefreshRuntime;
}
