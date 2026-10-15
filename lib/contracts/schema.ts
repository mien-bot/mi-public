import { z } from "zod";

export const contractTemplateIdSchema = z.enum([
  "residential-interiors",
  "concept-design",
  "architecture-permit",
]);

export type ContractTemplateId = z.infer<typeof contractTemplateIdSchema>;

const conciseText = (label: string, maximum: number) => z
  .string()
  .trim()
  .min(1, `${label} is required.`)
  .max(maximum, `${label} is too long.`);

const optionalText = (maximum: number) => z.string().trim().max(maximum);
const itemList = (label: string, maximumItems = 30) => z
  .array(conciseText(label, 500))
  .max(maximumItems, `Use no more than ${maximumItems} ${label.toLowerCase()} items.`);

export const contractFeeSchema = z.object({
  label: conciseText("Fee label", 180),
  amount: conciseText("Fee amount", 80),
});

export const contractDraftInputSchema = z.object({
  templateId: contractTemplateIdSchema,
  proposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid proposal date."),
  clientName: conciseText("Client name", 160),
  clientCompany: optionalText(160),
  contactInformation: optionalText(500),
  projectName: conciseText("Project name", 220),
  projectAddress: optionalText(320),
  projectArea: optionalText(100),
  projectDescription: conciseText("Project description", 1_500),
  services: itemList("Service").min(1, "Add at least one service."),
  clientResponsibilities: itemList("Client responsibility"),
  assumptions: itemList("Assumption"),
  fees: z.array(contractFeeSchema).min(1, "Add at least one fee.").max(12),
  reimbursableMarkup: optionalText(80),
  retainerSchedule: itemList("Payment milestone", 12).min(1, "Add at least one payment milestone."),
  additionalTerms: optionalText(4_000),
  hourlyRate: optionalText(80),
  preparedBy: conciseText("Prepared by", 180),
  firmSigners: itemList("Firm signer", 6).min(1, "Add at least one firm signer."),
});

export type ContractDraftInput = z.infer<typeof contractDraftInputSchema>;
