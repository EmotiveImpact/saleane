// SALEANE design language: the components every screen builds from.
// Documented in docs/DESIGN_LANGUAGE.md and shown live at /design-language.
import './design.css'
import './components/controls.css'

export { Avatar, Button, Empty, ErrorMessage, Metric, Status } from './components/primitives'
export { Definition } from './components/Definition'
export { Stat, Stats } from './components/Stats'
export { Modal } from './components/Modal'
export { Menu, MenuChoices, MenuItem, MenuLabel, MenuSeparator } from './components/Menu'
export { Tip } from './components/Tip'
export { Notices } from './components/Notices'
export { notify } from './components/notices'
export { Fold } from './components/Fold'
export { MovingList, MovingRow } from './components/Moving'
export { useStepArrival } from './useStepArrival'
export { ChosenMark } from './components/ChosenMark'
export { Select } from './components/Select'
export { CalmMotion } from './components/CalmMotion'
export {
  arriveGently,
  calm,
  quick,
  leaveGently,
  motionAllowed,
  settleFrom,
  useMotionAllowed,
} from './motion'
export { ChoiceTiles, WizardFooter, WizardSteps } from './components/Wizard'
export { useWizardStep } from './components/useWizardStep'
export { PageHeader } from './components/PageHeader'
export { SegmentedControl } from './components/SegmentedControl'
export { Tabs } from './components/Tabs'
export { TimeChoices } from './components/TimeChoices'
export { groupTimes } from './components/timeGroups'
export { DateStrip } from './components/DateStrip'
export type { StripDay } from './components/DateStrip'
export { photos, treatmentPhoto } from './photos'
export { PhotoStrip } from './components/PhotoStrip'
export { ScrollNav } from './components/ScrollNav'
export { useScrollEdges } from './components/useScrollEdges'
export { DateField } from './components/DateField'
export { TimeField } from './components/TimeField'
export { writtenDate } from './components/dates'
export { LoadingShapes } from './components/LoadingShapes'
export { MoreOptions } from './components/MoreOptions'
