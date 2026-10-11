import type { ValueKind, Vocabulary } from './fields'

/**
 * Moving in, stage 2: what each column in an old system's visits file means. Headings come from
 * Fresha's appointments list, Vagaro's appointments summary, Timely's appointment schedule,
 * Acuity, Square and SALEANE's own switching file (see
 * /mnt/project-files/moving-in/export-field-map.md); anything else is read by what is inside it.
 */

export const visitFields = [
  'client',
  'firstName',
  'lastName',
  'email',
  'phone',
  'date',
  'time',
  'duration',
  'treatment',
  'professional',
  'status',
  'price',
  'deposit',
  'reference',
] as const
export type VisitField = (typeof visitFields)[number]

export const VISIT_FIELD_LABEL: Record<VisitField, string> = {
  client: 'Client',
  firstName: 'Client’s first name',
  lastName: 'Client’s last name',
  email: 'Client’s email',
  phone: 'Client’s phone',
  date: 'Date',
  time: 'Start time',
  duration: 'Length',
  treatment: 'Treatment',
  professional: 'Professional',
  status: 'Status',
  price: 'Price',
  deposit: 'Deposit paid',
  reference: 'Booking reference',
}

const SYNONYMS: Record<VisitField, string[]> = {
  client: [
    'client',
    'customer',
    'clientname',
    'customername',
    'clientfullname',
    'customerfullname',
    'guest',
    'guestname',
    'name',
    'fullname',
    'contact',
    'contactname',
  ],
  firstName: [
    'firstname',
    'clientfirstname',
    'customerfirstname',
    'givenname',
    'forename',
    'first',
  ],
  lastName: ['lastname', 'clientlastname', 'customerlastname', 'surname', 'familyname', 'last'],
  email: [
    'email',
    'emailaddress',
    'clientemail',
    'clientemailaddress',
    'customeremail',
    'customeremailaddress',
    'guestemail',
  ],
  phone: [
    'phone',
    'mobile',
    'mobilenumber',
    'phonenumber',
    'clientphone',
    'clientmobile',
    'clientphonenumber',
    'customerphone',
    'cellphone',
    'cell',
    'telephone',
    'smsnumber',
    'contactnumber',
  ],
  date: [
    'scheduleddate',
    'appointmentdate',
    'date',
    'startdate',
    'starttime',
    'start',
    'startdatetime',
    'appointmentstart',
    'appointmentstarttime',
    'visitdate',
    'bookingdate',
    'datetime',
    'dateandtime',
    'appointmentdatetime',
    'scheduledfor',
    'when',
  ],
  time: ['time', 'apptslot', 'appointmentslot', 'slot', 'timeslot', 'appointmenttime', 'from'],
  duration: [
    'durationmins',
    'duration',
    'durationminutes',
    'length',
    'mins',
    'minutes',
    'appointmentlength',
    'serviceduration',
    'servicelength',
  ],
  treatment: [
    'service',
    'servicename',
    'services',
    'servicetitle',
    'servicedescription',
    'treatment',
    'treatmentname',
    'treatments',
    'appointmenttype',
    'type',
  ],
  professional: [
    'teammember',
    'employee',
    'employeename',
    'staff',
    'staffname',
    'staffmember',
    'professional',
    'stylist',
    'therapist',
    'practitioner',
    'provider',
    'serviceprovider',
    'calendar',
    'with',
    'assignedto',
    'technician',
    'artist',
    'barber',
  ],
  status: [
    'status',
    'appointmentstatus',
    'bookingstatus',
    'visitstatus',
    'state',
    'activationstate',
  ],
  price: [
    'netsales',
    'price',
    'amount',
    'total',
    'totalprice',
    'serviceprice',
    'grosssale',
    'grosssales',
    'cost',
    'value',
    'charge',
    'bookedprice',
    'quotedprice',
  ],
  deposit: [
    'upfrontpayments',
    'upfrontpayment',
    'upfront',
    'deposit',
    'depositpaid',
    'depositamount',
    'amountpaidonline',
    'paidonline',
    'prepaid',
    'prepayment',
    'paidinadvance',
  ],
  reference: [
    'apptref',
    'appointmentref',
    'appointmentreference',
    'appointmentid',
    'appointmentnumber',
    'reference',
    'ref',
    'bookingref',
    'bookingreference',
    'bookingid',
    'bookingnumber',
    'confirmationnumber',
    'id',
  ],
}

/**
 * Columns about when a visit was booked, where, or what was charged besides its price, and a
 * client list's own summaries ("Last visit", "Preferred staff").
 */
const NEVER_STARTS =
  /^((last|first|next|previous|recent)\s+(visit|appointment|booking|seen|service|treatment|staff)|preferred|favou?rite|usual|date (scheduled|booked|created)|booked (by|on)|business|room|station|fees?\b|tips?\b|discount|tax|vat|invoice|notes?\b|comments?|memo|source|channel|referr|label|payment (method|status|type)|paid (on|by|with))/i
const NEVER_ANYWHERE =
  /categor|cancel|created|modified|updated|location|branch|resource|reason|colou?r/i

function leftOut(heading: string, kind: ValueKind) {
  const words = heading.replace(/([a-z])([A-Z])/g, '$1 $2')
  if (/cancel/i.test(words)) return 'Not needed: cancelled visits stay behind.'
  if (/created|booked (by|on)|date (scheduled|booked)|modified|updated/i.test(words))
    return 'When or by whom it was booked is not needed.'
  if (/location|branch|site|venue|business/i.test(words))
    return 'Each visit goes where its professional works that day.'
  if (/resource|room|chair|station/i.test(words))
    return 'SALEANE chooses the room or chair, as it does for every visit.'
  if (/categor|group/i.test(words)) return 'Not needed: the treatment says it.'
  if (/note|comment|memo/i.test(words)) return 'Visit notes are not brought across yet.'
  if (kind === 'money' || /fee|charge|tip|discount|tax|vat|invoice|paid|payment/i.test(words))
    return 'Only the price and any deposit already paid come across.'
  if (/\bid\b|reference|ref\.?$/i.test(words)) return 'The old system’s own reference. Not needed.'
  return 'SALEANE has no place for this yet.'
}

export const visitVocabulary: Vocabulary<VisitField> = {
  fields: visitFields,
  label: VISIT_FIELD_LABEL,
  synonyms: SYNONYMS,
  near: [
    'deposit',
    'reference',
    'firstName',
    'lastName',
    'email',
    'phone',
    'duration',
    'professional',
    'treatment',
    'status',
    'date',
    'time',
    'price',
    'client',
  ],
  expected: {
    email: ['email'],
    phone: ['phone'],
    date: ['date'],
    time: ['time'],
    price: ['money', 'number'],
    deposit: ['money', 'number'],
  },
  never: (heading) => NEVER_STARTS.test(heading) || NEVER_ANYWHERE.test(heading),
  fromValues: (kind) =>
    kind === 'email'
      ? 'email'
      : kind === 'phone'
        ? 'phone'
        : kind === 'date'
          ? 'date'
          : kind === 'time'
            ? 'time'
            : null,
  leftOut,
}

export function isVisitField(value: string | null): value is VisitField {
  return visitFields.includes(value as VisitField)
}
