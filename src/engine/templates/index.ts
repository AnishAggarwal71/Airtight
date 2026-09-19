import type { CrimeType } from '../types'
import type { Template } from './shared'
import { arsonTemplates } from './arson'
import { embezzlementTemplates } from './embezzlement'
import { homicideTemplates } from './homicide'

/** Templates keyed by crime type — what generate() draws from. */
export const TEMPLATES: Record<CrimeType, Template[]> = {
  homicide: homicideTemplates,
  arson: arsonTemplates,
  embezzlement: embezzlementTemplates,
}

/** Flat list of every template — used by verify.ts for coverage/reachability checks. */
export const ALL_TEMPLATES: Template[] = [
  ...homicideTemplates,
  ...arsonTemplates,
  ...embezzlementTemplates,
]
