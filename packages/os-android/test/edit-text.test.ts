import { describe, expect, it } from 'vitest';
import { createDevice } from '@mimicry/testing';
import { Activity, Color, EditText, EditorInfo, FrameLayout, FrameLayoutParams, Gravity, InputType, LayoutParams, View } from '@mimicry/os-android';

describe('EditText', () => {
  it('takes focus on tap, runs the keyboard\'s edits through TextWatchers and reports the IME action', () => {
    const device = createDevice({ device: 'pixel-9' });
    let field!: EditText;
    let other!: View;
    class Main extends Activity {
      protected override onCreate(): void {
        const frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.WHITE);
        field = new EditText(this);
        field.setHint('Name');
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        field.setImeOptions(EditorInfo.IME_ACTION_SEND);
        frame.addView(field, -1, new FrameLayoutParams(300, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        other = new View(this);
        other.setFocusable(true);
        frame.addView(other, -1, new FrameLayoutParams(10, 10, Gravity.TOP | Gravity.LEFT));
        this.setContentView(frame);
      }
    }
    new Main(device.kernel, device.android.windowManager).launch();
    device.advance(32);
    const events: string[] = [];
    field.setOnFocusChangeListener((_v, has) => events.push(has ? 'focus' : 'blur'));
    field.addTextChangedListener({ onTextChanged: (_s, start, before, count) => events.push(`changed ${start} ${before} ${count}`), afterTextChanged: (s) => events.push(`after ${s}`) });
    field.setOnEditorActionListener((_v, action) => {
      events.push(`action ${action}`);
      return true;
    });
    const [x, y] = field.getLocationInWindow();
    device.tap(x + 20, y + field.getHeight() / 2);
    expect(field.isFocused()).toBe(true);
    expect(device.messages.some((m) => m.type === 'focusInput' && m.nodeId === field.inputId)).toBe(true);
    device.kernel.handle({ type: 'textChange', nodeId: field.inputId, text: 'Ada' });
    expect(field.getText()).toBe('Ada');
    device.kernel.handle({ type: 'textEvent', nodeId: field.inputId, event: 'submit' });
    other.requestFocus();
    expect(field.isFocused()).toBe(false);
    expect(events).toEqual(['focus', 'changed 0 0 3', 'after Ada', `action ${EditorInfo.IME_ACTION_SEND}`, 'blur']);
    expect(device.messages.some((m) => m.type === 'blurInput' && m.nodeId === field.inputId)).toBe(true);
    device.advance(16);
    expect(device.screenshot(1).length).toBeGreaterThan(0);
  });
});
