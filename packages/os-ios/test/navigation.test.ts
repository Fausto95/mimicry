import { describe, expect, it } from 'vitest';
import {
  CGRectMake, UIBarButtonItem, UIBarButtonSystemItem, UIColor, UIFont, UIImage, UILabel, UINavigationBarAppearance,
  UINavigationController, UIScrollView, UITabBarController, UITabBarItem, UIView, UIViewController,
  type UINavigationControllerDelegate,
} from '@mimicry/os-ios';
import { createDevice } from '@mimicry/testing';
import { pixel, saveArtifact } from './helpers';

class ListController extends UIViewController {
  readonly log: string[] = [];
  scroll!: UIScrollView;

  constructor(title: string, private readonly rows = 30) {
    super();
    this.title = title;
  }

  override loadView(): void {
    const scroll = new UIScrollView();
    scroll.backgroundColor = UIColor.systemGroupedBackground;
    scroll.alwaysBounceVertical = true;
    this.scroll = scroll;
    this.view = scroll;
  }

  override viewDidLoad(): void {
    const card = new UIView(CGRectMake(16, 16, 370, this.rows * 44));
    card.backgroundColor = UIColor.secondarySystemGroupedBackground;
    card.layer.cornerRadius = 26;
    card.clipsToBounds = true;
    for (let i = 0; i < this.rows; i++) {
      const label = new UILabel(CGRectMake(20, i * 44, 330, 44));
      label.text = `${this.title} row ${i + 1}`;
      card.addSubview(label);
      if (i > 0) {
        const sep = new UIView(CGRectMake(20, i * 44, 350, 1 / 3));
        sep.backgroundColor = UIColor.separator;
        card.addSubview(sep);
      }
    }
    this.scroll.addSubview(card);
    this.scroll.contentSize = { width: 402, height: this.rows * 44 + 32 };
  }

  override viewWillAppear(): void { this.log.push(`${this.title}:willAppear`); }
  override viewDidAppear(): void { this.log.push(`${this.title}:didAppear`); }
  override viewWillDisappear(): void { this.log.push(`${this.title}:willDisappear`); }
  override viewDidDisappear(): void { this.log.push(`${this.title}:didDisappear`); }
}

function navScene(options: { large?: boolean } = {}) {
  const device = createDevice({ device: 'iphone-17-pro' });
  const window = device.ios.application.makeWindow();
  const root = new ListController('Inbox');
  const nav = new UINavigationController(root);
  nav.navigationBar.prefersLargeTitles = !!options.large;
  window.rootViewController = nav;
  window.makeKeyAndVisible();
  device.advance(32);
  return { device, window, nav, root };
}

describe('UINavigationController', () => {
  it('puts the bar under the status bar and the content below it', () => {
    const { nav, root } = navScene();
    const top = nav.view.safeAreaInsets.top;
    expect(nav.navigationBar.frame.size.height).toBe(top + 44);
    expect(root.view.safeAreaInsets.top).toBe(top + 44);
    expect(root.scroll.contentOffset.y).toBe(-(top + 44));
    expect(nav.navigationBar.topItem?.title).toBe('Inbox');
  });

  it('pushes with the slide, calls appearance callbacks in order, and pops back', () => {
    const { device, nav, root } = navScene();
    const detail = new ListController('Detail', 5);
    const shown: string[] = [];
    const delegate: UINavigationControllerDelegate = {
      navigationControllerWillShow: (_n, vc) => shown.push(`will:${vc.title}`),
      navigationControllerDidShow: (_n, vc) => shown.push(`did:${vc.title}`),
    };
    nav.delegate = delegate;
    nav.pushViewController(detail, true);
    expect(nav.topViewController).toBe(detail);
    expect(detail.navigationController).toBe(nav);
    device.advance(100);
    const x = detail.view.layer.presentation().affineTransform?.[4] ?? 0;
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(402);
    const below = root.view.layer.presentation().affineTransform?.[4] ?? 0;
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-402 * 0.3);
    device.settle();
    expect(root.view.superview).toBeNull();
    expect(root.log).toEqual(['Inbox:willDisappear', 'Inbox:didDisappear']);
    expect(detail.log).toEqual(['Detail:willAppear', 'Detail:didAppear']);
    expect(shown).toEqual(['will:Detail', 'did:Detail']);
    // the back button pops
    device.tap(16 + 22, nav.navigationBar.frame.size.height - 22);
    device.settle();
    expect(nav.topViewController).toBe(root);
    expect(detail.parent).toBeNull();
    expect(root.log.slice(-2)).toEqual(['Inbox:willAppear', 'Inbox:didAppear']);
  });

  it('pops interactively from the left edge, or snaps back', () => {
    const { device, nav, root } = navScene();
    const detail = new ListController('Detail', 5);
    nav.pushViewController(detail, false);
    device.advance(17);
    // a short, slow drag cancels
    device.drag(5, 400, 120, 0, { duration: 1200, steps: 40 });
    device.settle();
    expect(nav.topViewController).toBe(detail);
    expect(detail.view.transform.tx).toBe(0);
    // past half the width completes
    device.drag(5, 400, 260, 0, { duration: 400, steps: 20 });
    device.settle();
    expect(nav.topViewController).toBe(root);
    expect(nav.viewControllers.length).toBe(1);
  });

  it('collapses a large title as the content scrolls', () => {
    const { device, nav, root } = navScene({ large: true });
    const top = nav.view.safeAreaInsets.top;
    expect(nav.navigationBar.frame.size.height).toBe(top + 96);
    expect(root.view.safeAreaInsets.top).toBe(top + 96);
    device.drag(200, 600, 0, -200, { duration: 300 });
    device.settle();
    expect(nav.navigationBar.frame.size.height).toBe(top + 44);
    expect(nav.navigationBar._atScrollEdge).toBe(false);
  });

  it('shows bar button items and runs their actions', () => {
    const { device, nav, root } = navScene();
    let adds = 0;
    root.navigationItem.rightBarButtonItems = [
      UIBarButtonItem.system(UIBarButtonSystemItem.add, () => adds++),
      new UIBarButtonItem('Edit'),
    ];
    device.advance(17);
    const bar = nav.navigationBar;
    const y = bar.frame.size.height - 22;
    device.tap(402 - 16 - 22, y);
    expect(adds).toBe(1);
  });

  it('applies appearances', () => {
    const { device, nav } = navScene();
    const appearance = new UINavigationBarAppearance();
    appearance.configureWithOpaqueBackground();
    appearance.backgroundColor = UIColor.systemIndigo;
    nav.navigationBar.standardAppearance = appearance;
    nav.navigationBar.scrollEdgeAppearance = appearance;
    nav.navigationBar.setNeedsDisplay();
    device.advance(17);
    expect(pixel(device, 200, 70)).toEqual([88, 86, 214]);
  });
});

describe('UITabBarController', () => {
  function tabs() {
    const device = createDevice({ device: 'iphone-17-pro' });
    const window = device.ios.application.makeWindow();
    const controller = new UITabBarController();
    const home = new UINavigationController(new ListController('Home'));
    home.tabBarItem = new UITabBarItem('Home', UIImage.systemName('house.fill'));
    home.navigationBar.prefersLargeTitles = true;
    const search = new ListController('Search');
    search.tabBarItem = new UITabBarItem('Search', UIImage.systemName('magnifyingglass'));
    const profile = new ListController('Profile');
    profile.tabBarItem = new UITabBarItem('Profile', UIImage.systemName('person.crop.circle'));
    profile.tabBarItem.badgeValue = '3';
    controller.viewControllers = [home, search, profile];
    window.rootViewController = controller;
    window.makeKeyAndVisible();
    device.advance(32);
    return { device, controller, home, search, profile };
  }

  it('floats the bar and puts it in the children’s bottom safe area', () => {
    const { controller, home } = tabs();
    expect(controller.tabBar.frame).toEqual(CGRectMake(25, 874 - 21 - 62, 352, 62));
    expect(home.topViewController!.view.safeAreaInsets.bottom).toBe(83);
  });

  it('switches tabs on tap and asks the delegate', () => {
    const { device, controller, search } = tabs();
    const picked: string[] = [];
    controller.delegate = {
      tabBarControllerShouldSelect: (_c, vc) => vc.title !== 'Profile',
      tabBarControllerDidSelect: (_c, vc) => picked.push(vc.title ?? ''),
    };
    const y = 874 - 21 - 31;
    device.tap(25 + 4 + (344 / 3) * 1.5, y);
    expect(controller.selectedViewController).toBe(search);
    expect(search.log).toEqual(['Search:willAppear', 'Search:didAppear']);
    device.tap(25 + 4 + (344 / 3) * 2.5, y);
    expect(controller.selectedIndex).toBe(1);
    expect(picked).toEqual(['Search']);
  });

  it('renders a navigation + list + tab bar screen', () => {
    const { device, home } = tabs();
    const root = home.topViewController!;
    root.navigationItem.rightBarButtonItems = [UIBarButtonItem.system(UIBarButtonSystemItem.add), UIBarButtonItem.system(UIBarButtonSystemItem.search)];
    root.navigationItem.leftBarButtonItem = new UIBarButtonItem('Edit');
    device.advance(17);
    saveArtifact('navigation-tabs.png', device.screenshot());
    device.drag(200, 600, 0, -260, { duration: 300 });
    device.settle();
    saveArtifact('navigation-tabs-scrolled.png', device.screenshot());
    const detail = new ListController('Details', 6);
    home.pushViewController(detail, true);
    device.advance(150);
    saveArtifact('navigation-push.png', device.screenshot());
    device.settle();
    saveArtifact('navigation-detail.png', device.screenshot());
    void UIFont;
  });
});
