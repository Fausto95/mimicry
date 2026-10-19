import { describe, expect, it } from 'vitest';
import {
  CGRectMake, IndexPath, UIColor, UIImage, UIImageSymbolConfiguration, UINavigationController, UISwitch, UITabBarController,
  UITabBarItem, UITableView, UITableViewCell, UITableViewCellAccessoryType, UITableViewCellStyle, UITableViewStyle, UIViewController,
  type UITableViewDataSource, type UITableViewDelegate,
} from '@mimicry/os-ios';
import { createDevice } from '@mimicry/testing';
import { boot, saveArtifact } from './helpers';

class Rows implements UITableViewDataSource, UITableViewDelegate {
  made = 0;
  readonly selected: string[] = [];

  constructor(readonly sections: Array<{ title?: string; footer?: string; rows: string[] }>, readonly style = UITableViewCellStyle.default) {}

  numberOfSections(): number {
    return this.sections.length;
  }

  tableViewNumberOfRowsInSection(_t: UITableView, section: number): number {
    return this.sections[section]!.rows.length;
  }

  tableViewCellForRowAt(table: UITableView, indexPath: IndexPath): UITableViewCell {
    const cell = table.dequeueReusableCell('cell') ?? (this.made++, new UITableViewCell(this.style, 'cell'));
    cell.textLabel.text = this.sections[indexPath.section]!.rows[indexPath.row]!;
    if (cell.detailTextLabel) cell.detailTextLabel.text = 'Detail';
    cell.accessoryType = UITableViewCellAccessoryType.disclosureIndicator;
    return cell;
  }

  tableViewTitleForHeaderInSection(_t: UITableView, section: number): string | null {
    return this.sections[section]!.title ?? null;
  }

  tableViewTitleForFooterInSection(_t: UITableView, section: number): string | null {
    return this.sections[section]!.footer ?? null;
  }

  tableViewDidSelectRowAt(table: UITableView, indexPath: IndexPath): void {
    this.selected.push(indexPath.toString());
    table.deselectRow(indexPath, true);
  }
}

function tableScene(rows: Rows, style = UITableViewStyle.plain) {
  const env = boot();
  const table = new UITableView(CGRectMake(0, 0, 402, 874), style);
  table.dataSource = rows;
  table.delegate = rows;
  env.root.view.addSubview(table);
  env.device.advance(17);
  return { ...env, table };
}

describe('UITableView', () => {
  it('only makes cells for visible rows and reuses them while scrolling', () => {
    const rows = new Rows([{ rows: Array.from({ length: 200 }, (_, i) => `Row ${i}`) }]);
    const { device, table } = tableScene(rows);
    expect(table.contentSize.height).toBe(200 * 44);
    const first = table.visibleCells.length;
    expect(first).toBeLessThan(30);
    expect(table.indexPathsForVisibleRows[0]!.row).toBe(0);
    device.drag(200, 700, 0, -500, { duration: 300 });
    device.settle();
    expect(table.indexPathsForVisibleRows[0]!.row).toBeGreaterThan(5);
    expect(rows.made).toBeLessThan(first + 15); // recycled, not made again
    table.scrollToRow(new IndexPath(150, 0), 1, false);
    device.advance(17);
    expect(table.cellForRow(new IndexPath(150, 0))?.textLabel.text).toBe('Row 150');
  });

  it('selects a tapped row and tells the delegate; a scroll cancels the highlight', () => {
    const rows = new Rows([{ rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'] }]);
    const { device, table } = tableScene(rows);
    const top = -table.contentOffset.y;
    device.tap(200, top + 44 * 2 + 22);
    expect(rows.selected).toEqual(['[0, 2]']);
    expect(table.indexPathForSelectedRow).toBeNull(); // the delegate deselected it
    device.drag(200, top + 44 * 3 + 22, 0, -200, { duration: 300 });
    device.settle();
    expect(rows.selected).toEqual(['[0, 2]']);
    expect(table.visibleCells.every((c) => !c.isHighlighted)).toBe(true);
  });

  it('self-sizes subtitle rows and lays out grouped sections with headers and footers', () => {
    const rows = new Rows([
      { title: 'General', rows: ['About', 'Software Update'], footer: 'Keep your device up to date.' },
      { rows: ['Privacy'] },
    ], UITableViewCellStyle.subtitle);
    const { table } = tableScene(rows, UITableViewStyle.insetGrouped);
    const r0 = table.rectForRow(new IndexPath(0, 0));
    expect(r0.origin.x).toBe(16);
    expect(r0.size.height).toBeGreaterThan(50);
    const cell = table.cellForRow(new IndexPath(0, 0))!;
    expect(cell.layer.cornerRadius).toBe(26);
    expect(table.cellForRow(new IndexPath(1, 0))!.layer.maskedCorners).toBe(4 | 8);
    const r2 = table.rectForRow(new IndexPath(0, 1));
    expect(r2.origin.y).toBeGreaterThan(r0.origin.y + r0.size.height * 2 + 30);
  });

  it('renders a settings screen in a navigation controller with a tab bar', () => {
    const device = createDevice({ device: 'iphone-17-pro' });
    const window = device.ios.application.makeWindow();
    class Settings extends UIViewController implements UITableViewDataSource {
      readonly data = [
        { title: null, rows: [['Airplane Mode', 'airplane', 'orange', 'switch'], ['Wi-Fi', 'wifi', 'blue', 'Home'], ['Bluetooth', 'wifi', 'blue', 'On']] },
        { title: 'Notifications', rows: [['Notifications', 'bell.fill', 'red', ''], ['Sounds & Haptics', 'speaker.wave.2', 'pink', ''], ['Focus', 'moon', 'indigo', '']] },
        { title: null, rows: [['General', 'gear', 'gray', ''], ['Display & Brightness', 'sun.max', 'blue', ''], ['Privacy & Security', 'lock.fill', 'blue', '']] },
      ];

      override loadView(): void {
        const table = new UITableView(CGRectMake(0, 0, 402, 874), UITableViewStyle.insetGrouped);
        table.dataSource = this;
        this.view = table;
      }

      numberOfSections(): number {
        return this.data.length;
      }

      tableViewNumberOfRowsInSection(_t: UITableView, s: number): number {
        return this.data[s]!.rows.length;
      }

      tableViewTitleForHeaderInSection(_t: UITableView, s: number): string | null {
        return this.data[s]!.title;
      }

      tableViewCellForRowAt(table: UITableView, indexPath: IndexPath): UITableViewCell {
        const [title, symbol, color, value] = this.data[indexPath.section]!.rows[indexPath.row]!;
        const cell = table.dequeueReusableCell('row') ?? new UITableViewCell(UITableViewCellStyle.value1, 'row');
        cell.textLabel.text = title!;
        cell.detailTextLabel!.text = value === 'switch' ? '' : value!;
        const tint = { orange: UIColor.systemOrange, blue: UIColor.systemBlue, red: UIColor.systemRed, pink: UIColor.systemPink, indigo: UIColor.systemIndigo, gray: UIColor.systemGray }[color!]!;
        cell.imageView.image = UIImage.systemName(symbol!, UIImageSymbolConfiguration.fromPointSize(16))!.withTintColor(tint);
        if (value === 'switch') {
          cell.accessoryView = new UISwitch(CGRectMake(0, 0, 63, 28));
          cell.selectionStyle = 0;
        } else {
          cell.accessoryType = UITableViewCellAccessoryType.disclosureIndicator;
        }
        return cell;
      }
    }
    const settings = new Settings();
    settings.title = 'Settings';
    const nav = new UINavigationController(settings);
    nav.navigationBar.prefersLargeTitles = true;
    nav.tabBarItem = new UITabBarItem('Settings', UIImage.systemName('gear'));
    const other = new UIViewController();
    other.view.backgroundColor = UIColor.systemBackground;
    other.tabBarItem = new UITabBarItem('Library', UIImage.systemName('book'));
    const tabs = new UITabBarController();
    tabs.viewControllers = [nav, other];
    window.rootViewController = tabs;
    window.makeKeyAndVisible();
    device.advance(32);
    saveArtifact('settings.png', device.screenshot());
  });
});
