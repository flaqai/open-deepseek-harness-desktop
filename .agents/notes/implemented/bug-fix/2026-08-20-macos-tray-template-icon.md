# Agent Note: Give the macOS tray a dedicated template icon

Status: implemented

English | [中文](2026-08-20-macos-tray-template-icon.zh.md)

## Problem

The desktop host resized the full 1024-pixel application icon and marked it as a macOS template image. Because the rounded-square background is opaque, macOS converted the entire tile into one solid menu-bar color, which appeared as a plain white button instead of the application mark.

## Decision

macOS uses a dedicated black-and-alpha `tray-iconTemplate.png` derived from the application's rider-and-whale silhouette. The gradient tile is omitted, while the rider is reduced to a separated head and compact seated gesture that remains legible at menu-bar size. The artwork fills nearly all of its image bounds so the status-item allocation matches the visible mark. The source SVG keeps the optically centered small-size geometry maintainable, while 16-pixel and 32-pixel `@2x` PNGs follow Electron's template-image naming and density conventions. Windows and Linux continue to use the full-color application icon.

## Verification

The desktop asset build copies both template PNG densities without renaming them. The base asset is 16 by 16 RGBA with a 16-by-14 effective bound. The Retina asset is 32 by 32 RGBA with a centered 30-by-28 effective bound, and both retain transparent backgrounds. Desktop typechecking and the desktop build verify the consuming path.

## Consequences

The menu-bar icon follows light and dark system appearances and remains recognizable at native status-bar size. The application window, notifications, installers, and Dock continue using the existing full-color icon.
