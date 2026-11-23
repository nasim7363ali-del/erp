import type { Bootstrap } from '../api';
import AccountingDocuments from './AccountingDocuments';
export default function Vouchers(props:{boot:Bootstrap;offline:boolean}){return <AccountingDocuments {...props} kind="vouchers"/>;}
