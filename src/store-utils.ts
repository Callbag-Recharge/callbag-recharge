// ---------------------------------------------------------------------------
// Shared utility for creating store objects from functions
// ---------------------------------------------------------------------------

export function defineStore<T extends (...args: any[]) => any>(
  fn: T,
  props: Record<string, unknown>,
): T {
  // We need to handle getters properly — Object.assign copies their
  // *current value*, not the getter itself. Use defineProperties instead.
  const descriptors = Object.getOwnPropertyDescriptors(props);

  // Function.name is non-writable, so handle it via defineProperty
  if ('name' in descriptors) {
    const nameValue = descriptors.name.value ?? descriptors.name.get?.();
    delete descriptors.name;
    Object.defineProperty(fn, 'name', {
      value: nameValue,
      writable: false,
      configurable: true,
    });
  }

  Object.defineProperties(fn, descriptors);
  return fn;
}
