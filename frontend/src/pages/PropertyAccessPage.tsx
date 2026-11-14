import { useState } from 'react'

import InvitationCreateForm from './InvitationCreateForm'
import InvitationList from './InvitationList'
import PropertyMemberList from './PropertyMemberList'
import PropertySectionShell from './PropertySectionShell'

function PropertyAccessContent({
  propertyId, onUnauthorized, onNotFound,
}: {
  propertyId: number
  onUnauthorized: () => void
  onNotFound: () => void
}) {
  const [invitationReload, setInvitationReload] = useState(0)

  return (
    <section className="property-invitations">
      <h2>Участники</h2>
      <PropertyMemberList
        propertyId={propertyId}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
      <h2>Приглашения</h2>
      <InvitationCreateForm
        propertyId={propertyId}
        onCreated={() => setInvitationReload((value) => value + 1)}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
      <InvitationList
        propertyId={propertyId}
        reload={invitationReload}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
    </section>
  )
}

function PropertyAccessPage() {
  return (
    <PropertySectionShell title="Совместный доступ" ownerOnly>
      {(property, onUnauthorized, onNotFound) => (
        <PropertyAccessContent
          propertyId={property.id}
          onUnauthorized={onUnauthorized}
          onNotFound={onNotFound}
        />
      )}
    </PropertySectionShell>
  )
}

export default PropertyAccessPage
