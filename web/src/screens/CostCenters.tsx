import type { Bootstrap } from '../api';
import AccountingSetup from './AccountingSetup';
export default function CostCenters(props: { boot: Bootstrap; offline: boolean }) { return <AccountingSetup {...props} kind="cost-centers" />; }
