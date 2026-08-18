import ClientQuote from "./client-quote";

export const dynamic = "force-dynamic";

type Props={params:Promise<{token:string}>};

export default async function ExpertiseClientPage({params}:Props){
  const{token}=await params;
  return <ClientQuote token={token}/>;
}
