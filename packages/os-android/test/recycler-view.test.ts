import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, Adapter, Color, DividerItemDecoration, FrameLayout, GridLayoutManager, LayoutParams, LinearLayoutManager, MarginLayoutParams, RecyclerView,
  TextView, ViewHolder, type ViewGroup,
} from '@mimicry/os-android';

class Row extends ViewHolder {
  constructor(readonly text: TextView) {
    super(text);
  }
}

/** Items "Item n", `height(n)` dp tall; counts creations and bindings. */
class Items extends Adapter<Row> {
  created = 0;
  bound = 0;
  clicks: number[] = [];
  constructor(public items: string[], private readonly height: (n: number) => number = () => 56, private readonly width = LayoutParams.MATCH_PARENT) {
    super();
  }
  getItemCount(): number {
    return this.items.length;
  }
  onCreateViewHolder(parent: ViewGroup): Row {
    this.created++;
    const tv = new TextView(parent.context);
    tv.setTextColor(Color.BLACK);
    tv.setPadding(16, 0, 16, 0);
    const holder = new Row(tv);
    tv.setOnClickListener(() => this.clicks.push(holder.getBindingAdapterPosition()));
    return holder;
  }
  onBindViewHolder(holder: Row, position: number): void {
    this.bound++;
    holder.text.setText(this.items[position]!);
    holder.text.setLayoutParams(new MarginLayoutParams(this.width, this.height(position)));
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i}`);

function launch(adapter: Items, configure: (rv: RecyclerView, activity: Activity) => void = (rv, a) => rv.setLayoutManager(new LinearLayoutManager(a))): { device: Device; rv: RecyclerView } {
  const device = createDevice({ device: 'pixel-9' });
  let rv!: RecyclerView;
  class Main extends Activity {
    protected override onCreate(): void {
      const frame = new FrameLayout(this);
      frame.setBackgroundColor(Color.WHITE);
      rv = new RecyclerView(this);
      configure(rv, this);
      rv.setAdapter(adapter);
      frame.addView(rv);
      this.setContentView(frame);
    }
  }
  new Main(device.kernel, device.android.windowManager).launch();
  device.advance(32);
  return { device, rv };
}

const llm = (rv: RecyclerView) => rv.getLayoutManager() as LinearLayoutManager;
const childTexts = (rv: RecyclerView) => Array.from({ length: rv.getChildCount() }, (_, i) => String((rv.getChildAt(i) as TextView).getText()));

describe('RecyclerView', () => {
  it('binds only what fits and recycles views while scrolling', () => {
    const adapter = new Items(range(1000));
    const { device, rv } = launch(adapter);
    // 923 / 56 → 17 rows on screen
    expect(rv.getChildCount()).toBe(17);
    expect(adapter.created).toBe(17);
    expect(childTexts(rv)[0]).toBe('Item 0');
    for (let i = 0; i < 6; i++) device.drag(200, 800, 0, -600, { duration: 300 });
    device.settle();
    const first = llm(rv).findFirstVisibleItemPosition();
    expect(first).toBeGreaterThan(40);
    expect(adapter.created).toBeLessThan(30);
    expect(adapter.bound).toBeGreaterThan(50);
    expect(rv.getChildCount()).toBeLessThanOrEqual(18);
    expect(rv.getScrollY()).toBe(0);
    expect(rv.computeVerticalScrollOffset()).toBeGreaterThan(40 * 56);
  });

  it('jumps to a position and reports visible items', () => {
    const adapter = new Items(range(1000));
    const { rv } = launch(adapter);
    rv.scrollToPosition(500);
    expect(llm(rv).findFirstVisibleItemPosition()).toBe(500);
    expect(llm(rv).findFirstCompletelyVisibleItemPosition()).toBe(500);
    expect(childTexts(rv)[0]).toBe('Item 500');
    expect(rv.findViewHolderForAdapterPosition(505)).not.toBeNull();
    expect(rv.findViewHolderForAdapterPosition(10)).toBeNull();
    llm(rv).scrollToPositionWithOffset(10, 100);
    const holder = rv.findViewHolderForAdapterPosition(10)!;
    expect(holder.itemView.getTop() - rv.computeVerticalScrollOffset()).toBeCloseTo(100);
  });

  it('lands exactly on items of varied height', () => {
    const adapter = new Items(range(300), (n) => 40 + (n % 5) * 20);
    const { rv } = launch(adapter);
    rv.scrollToPosition(200);
    const holder = rv.findViewHolderForAdapterPosition(200)!;
    expect(holder.itemView.getTop() - rv.computeVerticalScrollOffset()).toBeCloseTo(0);
    expect(holder.itemView.getHeight()).toBe(40 + (200 % 5) * 20);
    rv.scrollToPosition(299);
    expect(llm(rv).findLastVisibleItemPosition()).toBe(299);
    expect(rv.canScrollVertically(1)).toBe(false);
  });

  it('reports scroll state changes and scroll deltas', () => {
    const adapter = new Items(range(200));
    const { device, rv } = launch(adapter);
    const states: number[] = [];
    let dy = 0;
    rv.addOnScrollListener({ onScrollStateChanged: (_r, s) => states.push(s), onScrolled: (_r, _dx, d) => (dy += d) });
    device.drag(200, 700, 0, -400, { duration: 120 });
    device.settle();
    expect(states[0]).toBe(RecyclerView.SCROLL_STATE_DRAGGING);
    expect(states).toContain(RecyclerView.SCROLL_STATE_SETTLING);
    expect(states[states.length - 1]).toBe(RecyclerView.SCROLL_STATE_IDLE);
    expect(dy).toBeCloseTo(rv.computeVerticalScrollOffset());
    expect(dy).toBeGreaterThan(400);
  });

  it('routes taps to the item under the finger after scrolling', () => {
    const adapter = new Items(range(100));
    const { device, rv } = launch(adapter);
    rv.scrollToPosition(30);
    device.advance(17);
    device.tap(200, 56 * 2 + 20);
    expect(adapter.clicks).toEqual([32]);
  });

  it('applies inserts, removals and changes on the next layout', () => {
    const adapter = new Items(range(50));
    const { device, rv } = launch(adapter);
    adapter.items.splice(0, 0, 'New');
    adapter.notifyItemInserted(0);
    device.advance(17);
    expect(childTexts(rv).slice(0, 2)).toEqual(['New', 'Item 0']);
    adapter.items.splice(1, 2);
    adapter.notifyItemRangeRemoved(1, 2);
    device.advance(17);
    expect(childTexts(rv).slice(0, 2)).toEqual(['New', 'Item 2']);
    adapter.items[0] = 'Changed';
    adapter.notifyItemChanged(0);
    device.advance(17);
    expect(childTexts(rv)[0]).toBe('Changed');
    adapter.items = ['Only'];
    adapter.notifyDataSetChanged();
    device.advance(17);
    expect(childTexts(rv)).toEqual(['Only']);
  });

  it('draws divider decorations between items', () => {
    const adapter = new Items(range(20));
    const { device, rv } = launch(adapter, (r, a) => {
      r.setLayoutManager(new LinearLayoutManager(a));
      r.addItemDecoration(new DividerItemDecoration(a, DividerItemDecoration.VERTICAL));
    });
    const second = rv.findViewHolderForAdapterPosition(1)!.itemView;
    // each item is followed by a 1 dp divider
    expect(second.getTop()).toBe(57);
    const png = PNG.sync.read(device.screenshot(1));
    const at = (y: number) => {
      const i = (y * png.width + 300) * 4;
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
    };
    const line = at(56);
    [0xca, 0xc4, 0xd0].forEach((v, i) => expect(Math.abs(line[i]! - v)).toBeLessThan(4));
    expect(at(30)).toEqual([255, 255, 255]);
  });

  it('lays out horizontally and in a grid', () => {
    const horizontal = new Items(range(30), () => 100, 120);
    const { rv } = launch(horizontal, (r, a) => r.setLayoutManager(new LinearLayoutManager(a, LinearLayoutManager.HORIZONTAL)));
    const one = rv.findViewHolderForAdapterPosition(1)!.itemView;
    expect([one.getLeft(), one.getTop(), one.getWidth()]).toEqual([120, 0, 120]);
    expect(rv.canScrollHorizontally(1)).toBe(true);
    expect(rv.canScrollVertically(1)).toBe(false);

    const grid = new Items(range(30), () => 80);
    const launched = launch(grid, (r, a) => r.setLayoutManager(new GridLayoutManager(a, 3)));
    const items = [0, 1, 2, 3].map((p) => launched.rv.findViewHolderForAdapterPosition(p)!.itemView);
    expect(items.map((v) => v.getTop())).toEqual([0, 0, 0, 80]);
    expect(items[1]!.getLeft()).toBeCloseTo(411 / 3);
    expect(items[0]!.getWidth()).toBeCloseTo(411 / 3);
  });
});
