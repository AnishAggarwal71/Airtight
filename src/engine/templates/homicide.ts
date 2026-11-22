import type { Template } from './shared.js'
import { stairwell } from './homicide/stairwell.js'
import { allotment } from './homicide/allotment.js'
import { nightShift } from './homicide/night-shift.js'
import { allergy } from './homicide/allergy.js'
import { openWater } from './homicide/open-water.js'
import { overdose } from './homicide/overdose.js'
import { lockIn } from './homicide/lock-in.js'
import { hikingTrail } from './homicide/hiking-trail.js'
import { smartGarage } from './homicide/smart-garage.js'
import { charityGala } from './homicide/charity-gala.js'

/**
 * Homicide, the anchor crime type. Long timelines, a relationship with the
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
