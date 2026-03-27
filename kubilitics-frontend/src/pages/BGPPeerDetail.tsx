import { Network, Clock, Info } from 'lucide-react';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';

interface K8sBGPPeer extends KubernetesResource {
  spec?: {
    peerAddress?: string;
    peerASN?: number;
    myASN?: number;
    holdTime?: string;
    keepaliveTime?: string;
    routerID?: string;
  };
}

function OverviewTab({ resource: peer, age }: ResourceContext<K8sBGPPeer>) {
  return (
    <div className="space-y-6">
      <SectionCard icon={Network} title="BGP Peer Spec" tooltip={<p className="text-xs text-muted-foreground">MetalLB BGP session config</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Peer Address" value={<span className="font-mono text-xs">{peer?.spec?.peerAddress ?? '—'}</span>} />
          <DetailRow label="Peer ASN" value={peer?.spec?.peerASN ?? '—'} />
          <DetailRow label="My ASN" value={peer?.spec?.myASN ?? '—'} />
          <DetailRow label="Hold Time" value={peer?.spec?.holdTime ?? '—'} />
          <DetailRow label="Keepalive Time" value={peer?.spec?.keepaliveTime ?? '—'} />
          <DetailRow label="Router ID" value={<span className="font-mono text-xs">{peer?.spec?.routerID ?? '—'}</span>} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={peer?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={peer?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function BGPPeerDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sBGPPeer>
      resourceType="bgppeers"
      kind="BGPPeer"
      pluralLabel="BGP Peers"
      listPath="/bgppeers"
      resourceIcon={Network}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const peer = ctx.resource;
        return [
          { label: 'Peer Address', value: peer?.spec?.peerAddress ?? '—', icon: Network, iconColor: 'primary' as const },
          { label: 'Peer ASN', value: peer?.spec?.peerASN != null ? String(peer.spec.peerASN) : '—', icon: Network, iconColor: 'info' as const },
          { label: 'My ASN', value: peer?.spec?.myASN != null ? String(peer.spec.myASN) : '—', icon: Network, iconColor: 'muted' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
