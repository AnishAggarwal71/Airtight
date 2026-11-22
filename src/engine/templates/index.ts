import type { CrimeType } from '../types.js'
import type { Template } from './shared.js'
import { embezzlementTemplates } from './embezzlement.js'
import { homicideTemplates } from './homicide.js'

/** Templates keyed by crime type, what generate() draws from. */
export const TEMPLATES: Record<CrimeType, Template[]> = {
  homicide: homicideTemplates,
  embezzlement: embezzlementTemplates,
}

/** Flat list of every template, used by verify.ts for coverage/reachability checks. */
export const ALL_TEMPLATES: Template[] = [
  ...homicideTemplates,
  ...embezzlementTemplates,
]
