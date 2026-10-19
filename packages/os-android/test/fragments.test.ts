import { describe, expect, it } from 'vitest';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, Fragment, FragmentContainerView, FragmentManager, FragmentTransaction, MaterialTransitions, TextView, View, type Context, type LayoutInflater,
  type ViewGroup,
} from '@mimicry/os-android';

/** A fragment that logs its lifecycle and shows its name. */
class Page extends Fragment {
  constructor(readonly name: string, readonly log: string[]) {
    super();
  }
  override onAttach(_c: Context): void { this.log.push(`${this.name}.attach`); }
  override onCreate(): void { this.log.push(`${this.name}.create`); }
  override onCreateView(inflater: LayoutInflater, _container: ViewGroup | null): View {
    this.log.push(`${this.name}.createView`);
    const t = new TextView(inflater.getContext());
    t.setText(this.name);
    return t;
  }
  override onViewCreated(): void { this.log.push(`${this.name}.viewCreated`); }
  override onStart(): void { this.log.push(`${this.name}.start`); }
  override onResume(): void { this.log.push(`${this.name}.resume`); }
  override onPause(): void { this.log.push(`${this.name}.pause`); }
  override onStop(): void { this.log.push(`${this.name}.stop`); }
  override onDestroyView(): void { this.log.push(`${this.name}.destroyView`); }
  override onDestroy(): void { this.log.push(`${this.name}.destroy`); }
  override onDetach(): void { this.log.push(`${this.name}.detach`); }
  override onHiddenChanged(hidden: boolean): void { this.log.push(`${this.name}.hidden=${hidden}`); }
}

function launch(first?: (activity: Activity, container: FragmentContainerView) => void): { device: Device; activity: Activity; container: FragmentContainerView; fm: FragmentManager } {
  const device = createDevice({ device: 'pixel-9' });
  let activity!: Activity;
  let container!: FragmentContainerView;
  class Main extends Activity {
    protected override onCreate(): void {
      activity = this;
      container = new FragmentContainerView(this);
      this.setContentView(container);
      first?.(this, container);
    }
  }
  new Main(device.kernel, device.android.windowManager).launch();
  device.advance(32);
  return { device, activity, container, fm: activity.getSupportFragmentManager() };
}

const shown = (container: FragmentContainerView) =>
  Array.from({ length: container.getChildCount() }, (_, i) => String((container.getChildAt(i) as TextView).getText()));

describe('fragments', () => {
  it('a fragment added in onCreate follows the activity up to resumed', () => {
    const log: string[] = [];
    let page!: Page;
    const { container, fm } = launch((activity, c) => {
      page = new Page('home', log);
      activity.getSupportFragmentManager().beginTransaction().add(c.getId(), page, 'home').commit();
    });
    expect(log).toEqual(['home.attach', 'home.create', 'home.createView', 'home.viewCreated', 'home.start', 'home.resume']);
    expect(shown(container)).toEqual(['home']);
    expect(page.isResumed()).toBe(true);
    expect(fm.findFragmentByTag('home')).toBe(page);
    expect(fm.findFragmentById(container.getId())).toBe(page);
    expect(container.getFragment()).toBe(page);
    expect(page.requireActivity()).toBeInstanceOf(Activity);
  });

  it('commit runs after the current task; commitNow runs at once', () => {
    const log: string[] = [];
    const { device, container, fm } = launch();
    const a = new Page('a', log);
    fm.beginTransaction().add(container.getId(), a).commit();
    expect(a.isAdded()).toBe(false);
    device.advance(17);
    expect(a.isAdded()).toBe(true);
    const b = new Page('b', log);
    fm.beginTransaction().add(container.getId(), b).commitNow();
    expect(b.isResumed()).toBe(true);
    expect(() => fm.beginTransaction().add(container.getId(), new Page('c', log)).addToBackStack(null).commitNow()).toThrow(/back stack/);
  });

  it('replace on the back stack keeps the old fragment created; back pops it', () => {
    const log: string[] = [];
    const { device, activity, container, fm } = launch();
    const list = new Page('list', log);
    fm.beginTransaction().add(container.getId(), list).commitNow();
    log.length = 0;
    const detail = new Page('detail', log);
    fm.beginTransaction().replace(container.getId(), detail).addToBackStack('detail').commit();
    device.advance(17);
    expect(log).toEqual(['list.pause', 'list.stop', 'list.destroyView', 'detail.attach', 'detail.create', 'detail.createView', 'detail.viewCreated', 'detail.start', 'detail.resume']);
    expect(shown(container)).toEqual(['detail']);
    expect(fm.getBackStackEntryCount()).toBe(1);
    expect(fm.getBackStackEntryAt(0).getName()).toBe('detail');
    log.length = 0;
    device.back();
    expect(log).toEqual(['detail.pause', 'detail.stop', 'detail.destroyView', 'detail.destroy', 'detail.detach', 'list.createView', 'list.viewCreated', 'list.start', 'list.resume']);
    expect(shown(container)).toEqual(['list']);
    expect(fm.getBackStackEntryCount()).toBe(0);
    expect(activity.isFinishing()).toBe(false);
    // nothing left to pop: back finishes the activity
    device.back();
    expect(activity.isFinishing()).toBe(true);
    expect(log.slice(-3)).toEqual(['list.destroyView', 'list.destroy', 'list.detach']);
  });

  it('pops back to a named entry', () => {
    const log: string[] = [];
    const { device, container, fm } = launch();
    fm.beginTransaction().add(container.getId(), new Page('root', log)).commitNow();
    for (const name of ['one', 'two', 'three']) {
      fm.beginTransaction().replace(container.getId(), new Page(name, log)).addToBackStack(name).commit();
      device.advance(17);
    }
    expect(fm.getBackStackEntryCount()).toBe(3);
    expect(fm.popBackStackImmediate('one', FragmentManager.POP_BACK_STACK_INCLUSIVE)).toBe(true);
    expect(fm.getBackStackEntryCount()).toBe(0);
    expect(shown(container)).toEqual(['root']);
  });

  it('show and hide toggle visibility and call onHiddenChanged', () => {
    const log: string[] = [];
    const { container, fm } = launch();
    const page = new Page('p', log);
    fm.beginTransaction().add(container.getId(), page).commitNow();
    fm.beginTransaction().hide(page).commitNow();
    expect(page.requireView().getVisibility()).toBe(View.GONE);
    expect(page.isHidden()).toBe(true);
    fm.beginTransaction().show(page).commitNow();
    expect(page.requireView().getVisibility()).toBe(View.VISIBLE);
    expect(log.filter((l) => l.includes('hidden'))).toEqual(['p.hidden=true', 'p.hidden=false']);
  });

  it('animates views in and out with Material transitions', () => {
    const log: string[] = [];
    const { device, container, fm } = launch();
    const a = new Page('a', log);
    fm.beginTransaction().add(container.getId(), a).commitNow();
    const b = new Page('b', log);
    fm.beginTransaction()
      .setCustomAnimations(MaterialTransitions.sharedAxisEnter('x', true), MaterialTransitions.sharedAxisExit('x', true))
      .replace(container.getId(), b)
      .commit();
    device.advance(17);
    expect(shown(container)).toEqual(['a', 'b']);
    const bView = b.requireView();
    expect(bView.getTranslationX()).toBeGreaterThan(0);
    device.advance(120);
    expect(bView.getAlpha()).toBeGreaterThan(0);
    device.advance(290);
    expect(shown(container)).toEqual(['b']);
    expect(bView.getTranslationX()).toBe(0);
    expect(bView.getAlpha()).toBe(1);
    expect(log.slice(-2)).toEqual(['a.destroy', 'a.detach']);

    const c = new Page('c', log);
    fm.beginTransaction().setTransition(FragmentTransaction.TRANSIT_FRAGMENT_FADE).replace(container.getId(), c).commit();
    device.advance(60);
    expect(c.requireView().getAlpha()).toBeLessThan(1);
    device.advance(200);
    expect(c.requireView().getAlpha()).toBe(1);
  });

  it('finishing the activity takes its fragments down', () => {
    const log: string[] = [];
    const { activity, container, fm } = launch();
    fm.beginTransaction().add(container.getId(), new Page('p', log)).commitNow();
    log.length = 0;
    activity.finish();
    expect(log).toEqual(['p.pause', 'p.stop', 'p.destroyView', 'p.destroy', 'p.detach']);
  });
});
