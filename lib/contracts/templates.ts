import type { ContractDraftInput, ContractTemplateId } from "@/lib/contracts/schema";

export interface ContractTemplateDefinition {
  id: ContractTemplateId;
  label: string;
  description: string;
  proposalTitle: string;
  projectDescription: string;
  services: string[];
  clientResponsibilities: string[];
  assumptions: string[];
  fees: ContractDraftInput["fees"];
  retainerSchedule: string[];
  hourlyRate: string;
}
export const contractTemplateDefinitions: ContractTemplateDefinition[] = [
  {
    id: "residential-interiors",
    label: "Residential interiors",
    description: "Interior design, finishes, furniture, documentation, bidding, and construction support.",
    proposalTitle: "Professional Interior Design Services Proposal",
    projectDescription: "Interior design services for a residential renovation.",
    services: [
      "Design development based on the approved project direction and owner requirements.",
      "Interior finish, fixture, material, and color selections with coordinated presentations.",
      "Furniture specifications, design boards, plans, schedules, and up to two review rounds.",
      "Construction documents for the interior design scope.",
      "Bidding and negotiation assistance for the documented design scope.",
      "Construction administration, submittal review, site observations, and punch-list support as listed in the fee schedule.",
    ],
    clientResponsibilities: [
      "Purchase furniture, fixtures, equipment, and owner-supplied materials unless otherwise listed.",
      "Engage specialty consultants and vendors that are outside the listed scope.",
      "Provide timely decisions, approvals, access, and accurate information needed to perform the services.",
    ],
    assumptions: [
      "Structural, mechanical, plumbing, and electrical engineering are excluded unless specifically listed in the fee schedule.",
      "Signage, low-voltage, audio-visual, security, and permit services are by others unless specifically listed.",
      "Changes to an approved scope, program, schedule, or design direction may require additional services with prior written approval.",
    ],
    fees: [{ label: "Interior design services", amount: "$0.00" }],
    retainerSchedule: [
      "40% non-refundable retainer due upon acceptance.",
      "Remaining fee billed by phase or monthly in proportion to services performed.",
    ],
    hourlyRate: "$100 / hour",
  },
  {
    id: "concept-design",
    label: "Concept design",
    description: "Early programming, planning, concept options, finishes, elevations, and renderings.",
    proposalTitle: "Pre-Design and Schematic Design Services Proposal",
    projectDescription: "Pre-design and schematic design services for an adaptive-reuse project.",
    services: [
      "Site verification of visible existing conditions and available background information.",
      "Precedent and benchmark research relevant to the project type and owner goals.",
      "Programming, area calculations, and identification of key operational relationships.",
      "Conceptual space layouts with up to two review rounds.",
      "Schematic interior design direction, including material and finish mood boards.",
      "Dimensioned schematic floor plans and up to four key schematic elevations.",
      "Up to four conceptual renderings based on the approved schematic direction.",
    ],
    clientResponsibilities: [
      "Provide the project program, equipment criteria, operational requirements, and available existing documents.",
      "Engage playground, equipment, furniture, audio-visual, security, and other specialty vendors or consultants.",
      "Engage a contractor for pricing, constructability input, and construction services.",
    ],
    assumptions: [
      "This scope is conceptual and is not intended for permit, pricing, or construction without additional documentation.",
      "Engineering, code relief, permitting, procurement, detailed millwork, and construction administration are excluded unless listed.",
      "Material changes to the approved program or concept may require additional services with prior written approval.",
    ],
    fees: [
      { label: "Programming and concept layout package", amount: "$0.00" },
      { label: "Full schematic design package (optional)", amount: "$0.00" },
    ],
    retainerSchedule: [
      "40% non-refundable retainer due upon acceptance of each selected package.",
      "60% balance due upon final delivery of each selected package.",
    ],
    hourlyRate: "$100 / hour",
  },
  {
    id: "architecture-permit",
    label: "Architecture + permit",
    description: "Survey, code due diligence, design, permit documents, bidding, and construction administration.",
    proposalTitle: "Professional Architecture Services Proposal",
    projectDescription: "Professional architecture services for an interior build-out and permit submission.",
    services: [
      "Field survey and documentation of visible existing architectural conditions.",
      "Schematic design review and code due diligence based on the confirmed occupancy and program.",
      "Design development, including coordinated plans, reflected ceiling plans, and elevations.",
      "Construction documents suitable for permit submission and contractor pricing for the listed scope.",
      "Coordination with owner-retained or separately contracted structural and MEP consultants.",
      "Permit submission support and responses to plan-review comments for the documented scope.",
      "Bidding and negotiation support, including review of contractor questions and bids.",
      "Construction administration services identified in the fee schedule, including meetings, submittal review, site observations, and punch-list support.",
    ],
    clientResponsibilities: [
      "Provide complete ownership, survey, lease, equipment, vendor, and existing-condition information available to the owner.",
      "Retain required specialty consultants, testing agencies, permit expeditors, and contractors unless specifically included.",
      "Pay permit, agency, utility, consultant, and contractor fees directly unless otherwise stated.",
    ],
    assumptions: [
      "Concealed or inaccessible conditions are not included in the field survey and may affect the design or fee if discovered.",
      "Sprinkler, fire alarm, low-voltage, security, signage, kitchen equipment, and specialty systems are by others unless listed.",
      "Agency approvals, contractor pricing, and construction outcomes cannot be guaranteed.",
      "Owner-directed scope, program, schedule, or code-strategy changes may require additional services with prior written approval.",
    ],
    fees: [
      { label: "Architecture services", amount: "$0.00" },
      { label: "Consultant services", amount: "TBD" },
      { label: "Permit expediting", amount: "TBD" },
    ],
    retainerSchedule: [
      "40% non-refundable retainer due upon acceptance.",
      "Remaining fee billed monthly in proportion to services performed by phase.",
    ],
    hourlyRate: "$150 / hour",
  },
];

export const standardContractTerms = [
  {
    title: "Standard of care",
    text: "The architect and designer will perform the services with the professional skill and care ordinarily provided by professionals practicing under similar circumstances. No warranty or guarantee is expressed or implied.",
  },
  {
    title: "Owner decisions and information",
    text: "The client will provide timely decisions, complete and accurate information, and access reasonably required for the services. The architect and designer may rely on information furnished by the client and the client's consultants.",
  },
  {
    title: "Site access and observations",
    text: "The architect and designer will have reasonable access to the project site. Site visits are observations of general progress and are not continuous inspection, control of construction means or methods, or responsibility for site safety.",
  },
  {
    title: "Nonconforming work",
    text: "The client may reject work that does not conform to the contract documents. The architect and designer will report observed nonconforming work but are not responsible for the contractor's failure to perform the work properly.",
  },
  {
    title: "Client and specialty consultants",
    text: "The client will retain consultants and vendors not expressly included in this proposal. The architect and designer will coordinate information furnished by those parties only to the extent included in the agreed scope.",
  },
  {
    title: "Instruments of service",
    text: "Drawings, specifications, models, renderings, and other design materials are instruments of service. The architect and designer retain their rights in those materials. The client receives a limited license to use them solely for this project after payment of amounts due.",
  },
  {
    title: "Digital information and reuse",
    text: "Electronic files are provided for convenience and may differ from signed or issued documents. Reuse, modification, or use on another project without written permission is at the client's sole risk.",
  },
  {
    title: "Limitation of liability",
    text: "To the fullest extent permitted by law, the total aggregate liability of the architect and designer for claims arising from these services will not exceed the professional fees actually paid under this agreement. This clause should be reviewed by the firm's attorney before use.",
  },
  {
    title: "Dispute resolution",
    text: "The parties will first attempt to resolve disputes through direct discussion and then non-binding mediation before litigation, unless they agree in writing to another procedure.",
  },
  {
    title: "Suspension and termination",
    text: "Either party may terminate this agreement after written notice if the other party materially fails to perform. The client will pay for services performed, approved additional services, and reimbursable expenses incurred through the termination date.",
  },
  {
    title: "Photographs and project credit",
    text: "Unless the client objects in writing, the architect and designer may photograph the project and use non-confidential images for professional publication and marketing, with reasonable efforts to avoid disclosing private client information.",
  },
];

export function getContractTemplate(id: ContractTemplateId): ContractTemplateDefinition {
  return contractTemplateDefinitions.find((template) => template.id === id) ?? contractTemplateDefinitions[0];
}

export function createContractDraft(templateId: ContractTemplateId = "architecture-permit"): ContractDraftInput {
  const template = getContractTemplate(templateId);
  return {
    templateId,
    proposalDate: new Date().toISOString().slice(0, 10),
    clientName: "",
    clientCompany: "",
    contactInformation: "",
    projectName: "",
    projectAddress: "",
    projectArea: "",
    projectDescription: template.projectDescription,
    services: [...template.services],
    clientResponsibilities: [...template.clientResponsibilities],
    assumptions: [...template.assumptions],
    fees: template.fees.map((fee) => ({ ...fee })),
    reimbursableMarkup: "10% above cost",
    retainerSchedule: [...template.retainerSchedule],
    additionalTerms: "",
    hourlyRate: template.hourlyRate,
    preparedBy: "Example Studio",
    firmSigners: ["Example Colleague", "Example Architect"],
  };
}
