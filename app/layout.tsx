import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'ACTOR | On-chain intelligence',description:'Auditable Solana wallet intelligence and paper trading research.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
