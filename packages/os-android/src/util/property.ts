/**
 * android.util.Property / FloatProperty / IntProperty: a named, typed
 * accessor ObjectAnimator and the dynamic animations drive (View.ALPHA,
 * View.TRANSLATION_X…). Java's class-object `type` argument has no
 * counterpart; the getter and setter are passed in instead.
 */
export class Property<T, V> {
  constructor(
    private readonly name: string,
    private readonly getter: (object: T) => V,
    private readonly setter: ((object: T, value: V) => void) | null = null,
  ) {}

  getName(): string {
    return this.name;
  }

  get(object: T): V {
    return this.getter(object);
  }

  set(object: T, value: V): void {
    if (!this.setter) throw new Error(`UnsupportedOperationException: Property ${this.name} is read-only`);
    this.setter(object, value);
  }

  isReadOnly(): boolean {
    return this.setter === null;
  }
}

export class FloatProperty<T> extends Property<T, number> {
  setValue(object: T, value: number): void {
    this.set(object, value);
  }
}

export class IntProperty<T> extends Property<T, number> {
  setValue(object: T, value: number): void {
    this.set(object, Math.trunc(value));
  }
}
