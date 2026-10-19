import { describe, expect, it } from 'vitest';
import { createDevice } from '@mimicry/testing';
import { CGRectMake, UIControlEvents, UITextBorderStyle, UITextField, UIViewController } from '@mimicry/os-ios';

describe('UITextField', () => {
  it('becomes first responder on tap, takes the keyboard\'s edits and returns', () => {
    const device = createDevice({ device: 'iphone-17-pro' });
    const window = device.ios.application.makeWindow();
    const vc = new UIViewController();
    window.rootViewController = vc;
    const field = new UITextField(CGRectMake(20, 200, 300, 40));
    field.borderStyle = UITextBorderStyle.roundedRect;
    field.placeholder = 'Name';
    const events: string[] = [];
    field.addTarget(() => events.push('changed'), UIControlEvents.editingChanged);
    field.addTarget(() => events.push('return'), UIControlEvents.editingDidEndOnExit);
    field.delegate = { textFieldDidBeginEditing: () => events.push('begin'), textFieldDidEndEditing: () => events.push('end') };
    vc.view.addSubview(field);
    window.makeKeyAndVisible();
    device.advance(16);
    device.tap(100, 220);
    expect(field.isFirstResponder).toBe(true);
    expect(device.messages.some((m) => m.type === 'focusInput' && m.nodeId === field.inputId)).toBe(true);
    device.kernel.handle({ type: 'textChange', nodeId: field.inputId, text: 'Ada' });
    expect(field.text).toBe('Ada');
    device.kernel.handle({ type: 'textEvent', nodeId: field.inputId, event: 'submit' });
    field.resignFirstResponder();
    expect(events).toEqual(['begin', 'changed', 'return', 'end']);
    expect(device.messages.some((m) => m.type === 'blurInput' && m.nodeId === field.inputId)).toBe(true);
    device.advance(16);
    expect(device.screenshot(1).length).toBeGreaterThan(0);
  });
});
