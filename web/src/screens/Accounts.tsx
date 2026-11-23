import type { Bootstrap } from '../api';
import AccountingSetup from './AccountingSetup';
export default function Accounts(props: { boot: Bootstrap; offline: boolean }) { return <AccountingSetup {...props} kind="accounts" />; }
