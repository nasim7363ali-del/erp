import type { Bootstrap } from '../api';
import AccountingDocuments from './AccountingDocuments';
export default function Journals(props:{boot:Bootstrap;offline:boolean}){return <AccountingDocuments {...props} kind="journals"/>;}
