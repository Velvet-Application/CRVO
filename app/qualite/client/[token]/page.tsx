import NetworkQualityPortal from "./network-quality-portal";

export const dynamic = "force-dynamic";

export default async function NetworkQualityPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <NetworkQualityPortal token={token} />;
}
