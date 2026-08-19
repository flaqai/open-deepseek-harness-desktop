/** Installation identity shared by profile boot and package management. */

import { fileURLToPath } from 'node:url'

/** Absolute package.json of this dsh installation in source and built layouts. */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))
