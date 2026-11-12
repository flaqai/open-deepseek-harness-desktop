---
kind: upgrade-guide
description: "客户端 Menu 调用方须将矩形回调替换为元素引用或捕获的视口坐标。"
---

# Menu 锚点输入

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-client-ui-primitives` 将 `Menu.getAnchorRect` 替换为用于外部触发元素的 `anchorRef` 或用于指针菜单的 `anchorPoint`。Portal 菜单使用官方 rc.2 的 CSS 锚点定位实现，浏览器须支持对应属性；定位跟随布局视口，不再将所有面板约束在视觉视口内。既有选区保留、复选行及键盘操作仍可使用。

本次社区迁移为 Menu 之外的自定义面板保留 `useAnchoredPosition` 和 `AnchoredPositionOptions`。这些面板的迁移另行进行，调用方不能假定它们已经移除。

## 迁移

1. 将 `getAnchorRect={() => trigger.current?.getBoundingClientRect() ?? null}` 替换为 `anchorRef={trigger}`。内联 `anchor` 无需外部引用。缺失的外部触发元素应保持不可用，不回退到占位元素。
2. 将指针位置的零尺寸矩形回调替换为 `anchorPoint={{ x, y }}`，使用客户端视口坐标。调用方不要添加 Safari 视觉视口偏移，Menu 在打开或坐标变化时只转换一次。
3. 为原始编辑器或导航控件保留 `returnFocus`，为编辑菜单保留 `preserveSelection`，并保留显式复选状态与无障碍菜单名称。
4. 重建全部调用方，检查打开、关闭、子菜单、键盘导航、焦点返回、编辑器选区和拼写操作，并覆盖缩放、平移及滚动。
