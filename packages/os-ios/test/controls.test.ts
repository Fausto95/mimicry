import { describe, expect, it } from 'vitest';
import {
  CGRectMake, NSDirectionalRectEdge, UIAction, UIBlurEffect, UIBlurEffectStyle, UIButton, UIButtonConfiguration, UIButtonType,
  UIColor, UIControlEvents, UIControlState, UIFont, UIGlassEffect, UIImage, UILabel, UIPageControl, UIProgressView, UIRefreshControl,
  UIScrollView, UISegmentedControl, UISlider, UIStepper, UIView, UIVisualEffectView, UIScrollViewContentInsetAdjustmentBehavior,
} from '@mimicry/os-ios';
import { boot, close, pixel, saveArtifact } from './helpers';

describe('UIButton', () => {
  it('sizes a configuration button from its content and insets', () => {
    boot();
    const config = UIButtonConfiguration.filled();
    config.title = 'Continue';
    const button = UIButton.withConfiguration(config);
    const size = button.intrinsicContentSize;
    expect(size.height).toBeCloseTo(20.333 + 14, 1);
    expect(size.width).toBeGreaterThan(24 + 50);
    expect(button.titleLabel.text).toBe('Continue');
  });

  it('draws filled, tinted and gray styles as capsules', () => {
    const { device, root } = boot();
    const make = (config: UIButtonConfiguration, y: number) => {
      config.title = 'Button';
      const b = UIButton.withConfiguration(config);
      b.frame = CGRectMake(20, y, 200, 44);
      root.view.addSubview(b);
      return b;
    };
    make(UIButtonConfiguration.filled(), 100);
    make(UIButtonConfiguration.tinted(), 160);
    make(UIButtonConfiguration.gray(), 220);
    device.advance(17);
    expect(pixel(device, 30, 122)).toEqual([0, 122, 255]);
    expect(pixel(device, 20.5, 101)).toEqual([255, 255, 255]); // the capsule's corner
    expect(close(pixel(device, 30, 182), [217, 235, 255], 4)).toBe(true);
    expect(close(pixel(device, 30, 242), [239, 239, 240], 4)).toBe(true);
  });

  it('places the image and subtitle', () => {
    boot();
    const config = UIButtonConfiguration.plain();
    config.title = 'Share';
    config.subtitle = 'with friends';
    config.image = UIImage.systemName('square.and.arrow.up');
    config.imagePadding = 8;
    config.imagePlacement = NSDirectionalRectEdge.top;
    const button = UIButton.withConfiguration(config);
    button.frame = CGRectMake(0, 0, 200, 120);
    button.layoutIfNeeded();
    expect(button.imageView.frame.origin.y).toBeLessThan(button.titleLabel.frame.origin.y);
    expect(button.subtitleLabel.frame.origin.y).toBeGreaterThan(button.titleLabel.frame.origin.y);
    expect(button.titleLabel.frame.origin.y - (button.imageView.frame.origin.y + button.imageView.frame.size.height)).toBeCloseTo(8, 3);
  });

  it('sends primary actions on tap and dims while pressed', () => {
    const { device, root } = boot();
    let taps = 0;
    const config = UIButtonConfiguration.plain();
    const button = UIButton.withConfiguration(config, new UIAction('Tap me', null, () => taps++));
    button.frame = CGRectMake(20, 300, 150, 44);
    root.view.addSubview(button);
    device.advance(17);
    device.pointer('down', 90, 322);
    expect(button.isHighlighted).toBe(true);
    expect(button.titleLabel.alpha).toBeCloseTo(0.3);
    device.pointer('up', 90, 322);
    device.advance(17);
    expect(taps).toBe(1);
    expect(button.titleLabel.alpha).toBe(1);
  });

  it('keeps legacy per-state titles and fades a system button back after a press', () => {
    const { device, root } = boot();
    const button = UIButton.withType(UIButtonType.system);
    button.setTitle('Normal', UIControlState.normal);
    button.setTitle('Disabled', UIControlState.disabled);
    button.setTitleColor(UIColor.systemRed, UIControlState.normal);
    expect(button.currentTitle).toBe('Normal');
    button.isEnabled = false;
    expect(button.currentTitle).toBe('Disabled');
    button.isEnabled = true;
    button.sizeToFit();
    expect(button.frame.size.height).toBeGreaterThanOrEqual(30);
    button.frame = CGRectMake(20, 400, 120, 40);
    root.view.addSubview(button);
    device.advance(17);
    device.pointer('down', 60, 420);
    expect(button.titleLabel.alpha).toBe(0.2);
    device.pointer('up', 60, 420);
    expect(button.titleLabel.alpha).toBe(1); // the model; on screen it fades
    device.advance(100);
    const shown = button.titleLabel.layer.presentation().opacity;
    expect(shown).toBeGreaterThan(0.2);
    expect(shown).toBeLessThan(1);
  });
});

describe('UISegmentedControl', () => {
  it('selects on touch up and slides the pill', () => {
    const { device, root } = boot();
    const control = new UISegmentedControl(['One', 'Two', 'Three']);
    control.frame = CGRectMake(20, 100, 300, 32);
    control.selectedSegmentIndex = 0;
    root.view.addSubview(control);
    let changes = 0;
    control.addTarget(() => changes++, UIControlEvents.valueChanged);
    device.advance(17);
    expect(control.intrinsicContentSize.height).toBe(32);
    device.tap(270, 116);
    expect(control.selectedSegmentIndex).toBe(2);
    expect(changes).toBe(1);
    device.settle();
    // the pill (white) now sits under "Three"
    expect(pixel(device, 228, 108)).toEqual([255, 255, 255]);
    expect(pixel(device, 30, 108)).not.toEqual([255, 255, 255]);
    control.selectedSegmentIndex = 1;
    expect(changes).toBe(1);
    control.setEnabled(false, 0);
    device.tap(60, 116);
    expect(control.selectedSegmentIndex).toBe(1);
  });
});

describe('UISlider, UIStepper, UIPageControl, UIProgressView', () => {
  it('drags the slider thumb', () => {
    const { device, root } = boot();
    const slider = new UISlider(CGRectMake(20, 100, 300, 28));
    slider.value = 0;
    const values: number[] = [];
    slider.addTarget((s) => values.push((s as UISlider).value), UIControlEvents.valueChanged);
    root.view.addSubview(slider);
    device.advance(17);
    device.drag(38, 114, 130, 0);
    expect(slider.value).toBeCloseTo(130 / (300 - 37), 1);
    expect(values.length).toBeGreaterThan(3);
    // touching the track away from the thumb does nothing
    device.tap(300, 114);
    expect(slider.value).toBeCloseTo(130 / (300 - 37), 1);
  });

  it('steps, repeats while held, and stops at the limits', () => {
    const { device, root } = boot();
    const stepper = new UIStepper();
    stepper.frame = CGRectMake(20, 100, 94, 32);
    stepper.maximumValue = 5;
    root.view.addSubview(stepper);
    device.advance(17);
    device.tap(90, 116);
    expect(stepper.value).toBe(1);
    device.pointer('down', 90, 116);
    device.advance(800);
    device.pointer('up', 90, 116);
    expect(stepper.value).toBe(5);
    device.tap(40, 116);
    expect(stepper.value).toBe(4);
  });

  it('pages and fills', () => {
    const { device, root } = boot();
    const pages = new UIPageControl();
    pages.numberOfPages = 5;
    pages.frame = CGRectMake(0, 100, 402, 26);
    root.view.addSubview(pages);
    let changes = 0;
    pages.addTarget(() => changes++, UIControlEvents.valueChanged);
    device.advance(17);
    device.tap(300, 113);
    expect(pages.currentPage).toBe(1);
    expect(changes).toBe(1);
    const progress = new UIProgressView();
    progress.frame = CGRectMake(20, 200, 200, 4);
    progress.setProgress(0.5, false);
    root.view.addSubview(progress);
    device.advance(17);
    expect(pixel(device, 60, 202)).toEqual([0, 122, 255]);
    expect(pixel(device, 180, 202)).not.toEqual([0, 122, 255]);
  });
});

describe('UIRefreshControl', () => {
  it('refreshes when pulled past the trigger and settles with the spinner showing', () => {
    const { device, root } = boot();
    const scroll = new UIScrollView(CGRectMake(0, 0, 402, 874));
    scroll.contentSize = { width: 402, height: 2000 };
    scroll.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentBehavior.never;
    scroll.alwaysBounceVertical = true;
    const refresh = new UIRefreshControl();
    let refreshes = 0;
    refresh.addTarget(() => refreshes++, UIControlEvents.valueChanged);
    scroll.refreshControl = refresh;
    root.view.addSubview(scroll);
    device.advance(17);
    device.drag(200, 200, 0, 400, { duration: 600, steps: 30 });
    expect(refreshes).toBe(1);
    expect(refresh.isRefreshing).toBe(true);
    device.settle();
    expect(scroll.contentOffset.y).toBeCloseTo(-60, 0);
    refresh.endRefreshing();
    device.settle();
    expect(scroll.contentOffset.y).toBeCloseTo(0, 0);
  });
});

describe('UIVisualEffectView', () => {
  it('blurs what is behind it and tints it', () => {
    const { device, root } = boot();
    root.view.backgroundColor = UIColor.systemRed;
    const stripes = new UIView(CGRectMake(0, 100, 402, 20));
    stripes.backgroundColor = UIColor.black;
    root.view.addSubview(stripes);
    const blur = new UIVisualEffectView(new UIBlurEffect(UIBlurEffectStyle.systemMaterial), CGRectMake(0, 60, 402, 120));
    root.view.addSubview(blur);
    device.advance(17);
    const [r, g, b] = pixel(device, 200, 110);
    // the black stripe is blurred and washed out
    expect(r).toBeGreaterThan(60);
    expect(g).toBeGreaterThan(40);
    expect(b).toBeGreaterThan(40);
  });

  it('renders a controls gallery', () => {
    const { device, root } = boot();
    root.view.backgroundColor = UIColor.systemGroupedBackground;
    const title = new UILabel(CGRectMake(20, 64, 362, 41));
    title.text = 'Controls';
    title.font = UIFont.boldSystemFont(34);
    root.view.addSubview(title);
    const styles: Array<[string, UIButtonConfiguration]> = [
      ['Filled', UIButtonConfiguration.filled()], ['Tinted', UIButtonConfiguration.tinted()], ['Gray', UIButtonConfiguration.gray()],
      ['Plain', UIButtonConfiguration.plain()], ['Glass', UIButtonConfiguration.glass()], ['Prominent', UIButtonConfiguration.prominentGlass()],
    ];
    styles.forEach(([name, config], i) => {
      config.title = name;
      if (i === 0) config.image = UIImage.systemName('star.fill');
      if (i === 0) config.imagePadding = 6;
      const b = UIButton.withConfiguration(config);
      b.frame = CGRectMake(20 + (i % 3) * 122, 120 + Math.floor(i / 3) * 54, 112, 40);
      root.view.addSubview(b);
    });
    const seg = new UISegmentedControl(['Day', 'Week', 'Month', 'Year']);
    seg.frame = CGRectMake(20, 240, 362, 32);
    seg.selectedSegmentIndex = 1;
    root.view.addSubview(seg);
    const slider = new UISlider(CGRectMake(20, 292, 362, 28));
    slider.value = 0.4;
    root.view.addSubview(slider);
    const stepper = new UIStepper();
    stepper.frame = CGRectMake(20, 340, 94, 32);
    stepper.value = 3;
    root.view.addSubview(stepper);
    const progress = new UIProgressView();
    progress.frame = CGRectMake(134, 354, 248, 4);
    progress.progress = 0.65;
    root.view.addSubview(progress);
    const pages = new UIPageControl();
    pages.numberOfPages = 5;
    pages.currentPage = 2;
    pages.frame = CGRectMake(0, 392, 402, 26);
    root.view.addSubview(pages);
    const glass = new UIVisualEffectView(new UIGlassEffect(), CGRectMake(40, 450, 322, 64));
    glass.layer.cornerRadius = 32;
    const glassLabel = new UILabel(CGRectMake(0, 0, 322, 64));
    glassLabel.text = 'Liquid Glass';
    glassLabel.textAlignment = 1;
    glass.contentView.addSubview(glassLabel);
    root.view.addSubview(glass);
    saveArtifact('controls.png', device.advance(17).screenshot());
  });
});
