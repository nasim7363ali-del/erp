import { CodeNamePicker as Picker, type Props } from '../ui/kit/CodeNamePicker';
import { pickerRecords } from './pickerCatalog';
export type { CatalogState } from '../ui/kit/CodeNamePicker';
/** Demo-only fixture adapter. Production callers must supply real records. */
export function CodeNamePicker(props: Props) { return <Picker {...props} records={props.records ?? pickerRecords[props.kind]} />; }
