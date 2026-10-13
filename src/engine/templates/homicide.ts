import type { Template } from './shared'
import { stairwell } from './homicide/stairwell'
import { allotment } from './homicide/allotment'
import { nightShift } from './homicide/night-shift'
import { allergy } from './homicide/allergy'
import { openWater } from './homicide/open-water'
import { overdose } from './homicide/overdose'
import { lockIn } from './homicide/lock-in'
import { hikingTrail } from './homicide/hiking-trail'
import { smartGarage } from './homicide/smart-garage'
import { charityGala } from './homicide/charity-gala'

/**
 * Homicide — the anchor crime type. Long timelines, a relationship with the
 * victim that gives every question a second layer, and pathology evidence that
 * is almost always hedged in the report and therefore arguable.
 *
 * Ten distinct scenarios, each with its own build() in src/engine/templates/homicide/.
 */
export const homicideTemplates: Template[] = [
  stairwell,
  allotment,
  nightShift,
  allergy,
  openWater,
  overdose,
  lockIn,
  hikingTrail,
  smartGarage,
  charityGala,
]
