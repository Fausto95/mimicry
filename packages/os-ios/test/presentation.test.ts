import { describe, expect, it } from 'vitest';
import {
  CGRectMake, UIColor, UILabel, UIModalPresentationStyle, UIModalTransitionStyle, UISheetPresentationControllerDetent,
  UISheetPresentationControllerDetentIdentifier, UIViewController, type UIAdaptivePresentationControllerDelegate,
} from '@mimicry/os-ios';
import { boot, pixel, saveArtifact } from './helpers';

class Logged extends UIViewController {
  readonly log: string[] = [];

  constructor(readonly name: string, readonly color: UIColor = UIColor.systemBackground) {
    super();
  }

  override viewDidLoad(): void {
    this.view.backgroundColor = this.color;
    const label = new UILabel(CGRectMake(20, 80, 300, 40));
    label.text = this.name;
    label.font = label.font.withSize(28);
    this.view.addSubview(label);
  }

  override viewWillAppear(): void { this.log.push('willAppear'); }
  override viewDidAppear(): void { this.log.push('didAppear'); }
  override viewWillDisappear(): void { this.log.push('willDisappear'); }
  override viewDidDisappear(): void { this.log.push('didDisappear'); }
}

function scene() {
  const env = boot();
  const presenter = new Logged('Presenter', UIColor.systemTeal);
  env.window.rootViewController = presenter;
  env.device.advance(17);
  return { ...env, presenter };
}

describe('modal presentation', () => {
  it('covers full screen from the bottom and removes the presenter', () => {
    const { device, presenter } = scene();
    const modal = new Logged('Modal');
    modal.modalPresentationStyle = UIModalPresentationStyle.fullScreen;
    let done = false;
    presenter.present(modal, true, () => (done = true));
    expect(modal.isBeingPresented).toBe(true);
    expect(presenter.presentedViewController).toBe(modal);
    expect(modal.presentingViewController).toBe(presenter);
    device.advance(120);
    const y = modal.view.layer.presentation().affineTransform?.[5] ?? 0;
    expect(y).toBeGreaterThan(50);
    expect(y).toBeLessThan(874);
    device.settle();
    expect(done).toBe(true);
    expect(modal.log).toEqual(['willAppear', 'didAppear']);
    expect(presenter.log).toEqual(['willDisappear', 'didDisappear']);
    expect(presenter.view.isHidden).toBe(true);
    modal.dismiss(true);
    expect(presenter.view.isHidden).toBe(false);
    device.settle();
    expect(presenter.presentedViewController).toBeNull();
    expect(presenter.log.slice(2)).toEqual(['willAppear', 'didAppear']);
    expect(modal.log.slice(2)).toEqual(['willDisappear', 'didDisappear']);
    expect(modal.view.superview).toBeNull();
  });

  it('keeps the presenter over full screen and cross-dissolves', () => {
    const { device, presenter } = scene();
    const modal = new Logged('Over', UIColor.black.withAlphaComponent(0.5));
    modal.modalPresentationStyle = UIModalPresentationStyle.overFullScreen;
    modal.modalTransitionStyle = UIModalTransitionStyle.crossDissolve;
    presenter.present(modal, true);
    device.advance(150);
    const alpha = modal.view.layer.presentation().opacity;
    expect(alpha).toBeGreaterThan(0.1);
    expect(alpha).toBeLessThan(0.9);
    device.settle();
    expect(presenter.log).toEqual([]);
    expect(presenter.view.isHidden).toBe(false);
  });

  it('presents a page sheet by default, scaling the presenter back', () => {
    const { device, presenter, window } = scene();
    const sheet = new Logged('Sheet');
    presenter.present(sheet, true);
    device.settle();
    const top = window.application!.screen.safeAreaInsets.top;
    expect(sheet.view.frame.origin.y).toBe(top + 10);
    expect(presenter.log).toEqual([]);
    expect(presenter.view.transform.a).toBeCloseTo(0.92, 3);
    expect(window.application!._systemStatusBarStyle).toBe('light-content');
    // black behind the scaled-back card, at the very top corner
    expect(pixel(device, 2, 2)).toEqual([0, 0, 0]);
    saveArtifact('sheet.png', device.screenshot());
    sheet.dismiss(true);
    device.settle();
    expect(presenter.view.transform.a).toBe(1);
    expect(window.application!._systemStatusBarStyle).toBeNull();
  });

  it('stops at detents and dismisses with a swipe down, telling the delegate', () => {
    const { device, presenter } = scene();
    const sheet = new Logged('Detents');
    const events: string[] = [];
    const delegate: UIAdaptivePresentationControllerDelegate = {
      presentationControllerWillDismiss: () => events.push('will'),
      presentationControllerDidDismiss: () => events.push('did'),
      presentationControllerDidAttemptToDismiss: () => events.push('attempt'),
    };
    const controller = sheet.sheetPresentationController!;
    controller.detents = [UISheetPresentationControllerDetent.medium(), UISheetPresentationControllerDetent.large()];
    controller.prefersGrabberVisible = true;
    sheet.presentationController.delegate = delegate;
    presenter.present(sheet, true);
    device.settle();
    expect(sheet.view.frame.origin.y).toBeCloseTo(874 - (874 - 62 - 10) / 2, 0);
    expect(presenter.view.transform.a).toBe(1); // medium: no scale-back, a dim instead
    saveArtifact('sheet-medium.png', device.screenshot());
    // drag up to large
    device.drag(200, 600, 0, -350, { duration: 300 });
    device.settle();
    expect(controller.selectedDetentIdentifier).toBe(UISheetPresentationControllerDetentIdentifier.large);
    // modal in presentation: it springs back
    sheet.isModalInPresentation = true;
    device.drag(200, 300, 0, 600, { duration: 300 });
    device.settle();
    expect(events).toEqual(['attempt']);
    expect(presenter.presentedViewController).toBe(sheet);
    sheet.isModalInPresentation = false;
    expect(controller.selectedDetentIdentifier).toBe(UISheetPresentationControllerDetentIdentifier.medium);
    device.drag(200, 560, 0, 300, { duration: 200 });
    device.settle();
    expect(events).toEqual(['attempt', 'will', 'did']);
    expect(presenter.presentedViewController).toBeNull();
  });

  it('dismisses by tapping the dimmed area above a medium sheet', () => {
    const { device, presenter } = scene();
    const sheet = new Logged('Medium');
    sheet.sheetPresentationController!.detents = [UISheetPresentationControllerDetent.medium()];
    presenter.present(sheet, true);
    device.settle();
    device.tap(200, 200);
    device.settle();
    expect(presenter.presentedViewController).toBeNull();
  });
});
