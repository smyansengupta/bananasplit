/**
 * The OpenAPI 3.1 document for the public CRM API, served at
 * /api/crm/v1/openapi.json (no key needed to read it). Kept by hand next to
 * ./handlers.ts and ./serialize.ts: a field added there is added here.
 */

const str = { type: "string" } as const;
const strN = { type: ["string", "null"] } as const;
const dt = { type: ["string", "null"], format: "date-time" } as const;
const int = { type: "integer" } as const;
const intN = { type: ["integer", "null"] } as const;
const bool = { type: "boolean" } as const;
const custom = { type: "object", additionalProperties: true, description: "Custom fields by field id." } as const;
const status = { type: "string", enum: ["ACTIVE", "INACTIVE", "ALUMNI"] } as const;

function list(ref: string) {
  return {
    type: "object",
    required: ["object", "data", "hasMore", "nextCursor"],
    properties: {
      object: { const: "list" },
      data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      hasMore: bool,
      nextCursor: { ...strN, description: "Pass as ?cursor= for the next page." },
    },
  };
}

const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "cursor", in: "query", schema: str, description: "nextCursor from the previous page." },
];

const idPath = [{ name: "id", in: "path", required: true, schema: str }];

function ok(ref: string, code = "200") {
  return {
    [code]: { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } },
    "4XX": { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  };
}

function body(ref: string) {
  return { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } };
}

export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Bananasplit CRM API",
      version: "1.0.0",
      description:
        "Read and write your organization's CRM: people, companies, pipeline items and their timeline. Authenticate with an API key from CRM settings: `Authorization: Bearer bsk_...`. Lists are newest first with cursor pagination. Nothing is deleted through the API: set `trashed: true` to move a record to the trash, `false` to restore it. Each key may make 300 requests a minute (60 of them writes).",
    },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "bsk_{organization}.{secret}" } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: str, message: str, fields: { type: "array", items: str } },
            },
          },
        },
        Person: {
          type: "object",
          properties: {
            id: str,
            object: { const: "person" },
            name: str,
            firstName: strN,
            lastName: strN,
            email: strN,
            emails: { type: "array", items: str },
            phone: strN,
            title: strN,
            companyId: strN,
            linkedinUrl: strN,
            website: strN,
            location: strN,
            relationship: strN,
            status,
            ownerId: strN,
            source: strN,
            lastContactedAt: dt,
            nextFollowUpAt: dt,
            keepInTouchDays: intN,
            doNotContact: bool,
            unsubscribed: bool,
            custom,
            trashed: bool,
            createdAt: dt,
            updatedAt: dt,
          },
        },
        PersonInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: strN,
            firstName: strN,
            lastName: strN,
            email: strN,
            emails: { type: "array", items: str, description: "Other addresses." },
            phone: strN,
            title: strN,
            companyId: strN,
            companyName: { ...strN, description: "The company with this name, or a new one." },
            linkedinUrl: strN,
            website: strN,
            location: strN,
            relationship: strN,
            status,
            ownerId: strN,
            source: strN,
            nextFollowUpAt: dt,
            keepInTouchDays: intN,
            doNotContact: bool,
            custom,
            trashed: bool,
          },
        },
        Company: {
          type: "object",
          properties: {
            id: str,
            object: { const: "company" },
            name: str,
            domain: strN,
            website: strN,
            industry: strN,
            size: strN,
            phone: strN,
            address: strN,
            description: strN,
            status,
            ownerId: strN,
            lastContactedAt: dt,
            nextFollowUpAt: dt,
            custom,
            trashed: bool,
            createdAt: dt,
            updatedAt: dt,
          },
        },
        CompanyInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: strN,
            domain: strN,
            website: strN,
            industry: strN,
            size: strN,
            phone: strN,
            address: strN,
            description: strN,
            status,
            ownerId: strN,
            nextFollowUpAt: dt,
            custom,
            trashed: bool,
          },
        },
        Item: {
          type: "object",
          description: "One thing moving through a pipeline (an application, a donation, a deal).",
          properties: {
            id: str,
            object: { const: "item" },
            title: str,
            pipelineId: str,
            stageId: str,
            stage: { type: "object", properties: { id: str, name: str, kind: { enum: ["OPEN", "WON", "LOST"] } } },
            amountCents: intN,
            currency: str,
            expectedOn: dt,
            closedAt: dt,
            closeReason: strN,
            forecastCategory: { enum: ["PIPELINE", "BEST_CASE", "COMMIT", "OMITTED"] },
            ownerId: strN,
            companyId: strN,
            primaryPersonId: strN,
            people: { type: "array", items: { type: "object", properties: { personId: str, role: strN } } },
            nextStep: strN,
            nextStepAt: dt,
            source: strN,
            custom,
            trashed: bool,
            createdAt: dt,
            updatedAt: dt,
          },
        },
        ItemInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            pipelineId: { ...str, description: "Required to make one; an item stays in its pipeline." },
            stageId: { ...str, description: "Changing it moves the item (closing stages may need closeReason)." },
            title: strN,
            amountCents: intN,
            expectedOn: dt,
            ownerId: strN,
            companyId: strN,
            primaryPersonId: strN,
            personIds: { type: "array", items: str, description: "Only when making one." },
            nextStep: strN,
            nextStepAt: dt,
            forecastCategory: { enum: ["PIPELINE", "BEST_CASE", "COMMIT", "OMITTED"] },
            closeReason: strN,
            source: strN,
            custom,
            trashed: bool,
          },
        },
        Activity: {
          type: "object",
          properties: {
            id: str,
            object: { const: "activity" },
            kind: str,
            direction: { enum: ["INBOUND", "OUTBOUND", null] },
            subject: strN,
            body: strN,
            occurredAt: dt,
            actorId: strN,
            source: strN,
            detail: { type: "object", additionalProperties: true },
            targets: {
              type: "array",
              items: { type: "object", properties: { kind: { enum: ["person", "company", "deal"] }, id: str } },
            },
            createdAt: dt,
          },
        },
        ActivityInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { enum: ["NOTE", "CALL", "EMAIL", "MEETING", "TEXT", "TASK"] },
            subject: strN,
            body: strN,
            occurredAt: { type: "string", format: "date-time" },
            direction: { enum: ["INBOUND", "OUTBOUND", null] },
            targets: {
              type: "array",
              items: {
                type: "object",
                required: ["kind", "id"],
                properties: { kind: { enum: ["person", "company", "item"] }, id: str },
              },
            },
            externalId: { ...str, description: "Your own id: sending it again updates the same activity." },
            trashed: bool,
          },
        },
        Pipeline: {
          type: "object",
          properties: {
            id: str,
            object: { const: "pipeline" },
            name: str,
            itemNoun: str,
            itemNounPlural: str,
            hasAmount: bool,
            currency: str,
            wonLabel: str,
            lostLabel: str,
            archived: bool,
            stages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: str,
                  name: str,
                  kind: { enum: ["OPEN", "WON", "LOST"] },
                  order: int,
                  probability: intN,
                  stuckAfterDays: intN,
                },
              },
            },
            createdAt: dt,
          },
        },
        PersonList: list("Person"),
        CompanyList: list("Company"),
        ItemList: list("Item"),
        ActivityList: list("Activity"),
        PipelineList: list("Pipeline"),
      },
    },
    paths: {
      "/people": {
        get: {
          summary: "List people",
          parameters: [
            ...page,
            { name: "q", in: "query", schema: str, description: "Name or email contains." },
            { name: "email", in: "query", schema: str, description: "Exactly this address (any of theirs)." },
            { name: "companyId", in: "query", schema: str },
            { name: "ownerId", in: "query", schema: str },
            { name: "status", in: "query", schema: status },
            { name: "relationship", in: "query", schema: str },
            { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "createdSince", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "trashed", in: "query", schema: bool },
          ],
          responses: ok("PersonList"),
        },
        post: { summary: "Add a person", requestBody: body("PersonInput"), responses: ok("Person", "201") },
      },
      "/people/{id}": {
        get: { summary: "Get a person", parameters: idPath, responses: ok("Person") },
        patch: { summary: "Change a person", parameters: idPath, requestBody: body("PersonInput"), responses: ok("Person") },
      },
      "/companies": {
        get: {
          summary: "List companies",
          parameters: [
            ...page,
            { name: "q", in: "query", schema: str },
            { name: "domain", in: "query", schema: str },
            { name: "ownerId", in: "query", schema: str },
            { name: "status", in: "query", schema: status },
            { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "trashed", in: "query", schema: bool },
          ],
          responses: ok("CompanyList"),
        },
        post: { summary: "Add a company", requestBody: body("CompanyInput"), responses: ok("Company", "201") },
      },
      "/companies/{id}": {
        get: { summary: "Get a company", parameters: idPath, responses: ok("Company") },
        patch: { summary: "Change a company", parameters: idPath, requestBody: body("CompanyInput"), responses: ok("Company") },
      },
      "/items": {
        get: {
          summary: "List pipeline items",
          parameters: [
            ...page,
            { name: "pipelineId", in: "query", schema: str },
            { name: "stageId", in: "query", schema: str },
            { name: "companyId", in: "query", schema: str },
            { name: "personId", in: "query", schema: str },
            { name: "ownerId", in: "query", schema: str },
            { name: "open", in: "query", schema: bool },
            { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "trashed", in: "query", schema: bool },
          ],
          responses: ok("ItemList"),
        },
        post: { summary: "Add an item", requestBody: body("ItemInput"), responses: ok("Item", "201") },
      },
      "/items/{id}": {
        get: { summary: "Get an item", parameters: idPath, responses: ok("Item") },
        patch: { summary: "Change or move an item", parameters: idPath, requestBody: body("ItemInput"), responses: ok("Item") },
      },
      "/activities": {
        get: {
          summary: "List timeline activity",
          parameters: [
            ...page,
            { name: "personId", in: "query", schema: str },
            { name: "companyId", in: "query", schema: str },
            { name: "itemId", in: "query", schema: str },
            { name: "kind", in: "query", schema: str },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          ],
          responses: ok("ActivityList"),
        },
        post: { summary: "Log an activity", requestBody: body("ActivityInput"), responses: ok("Activity", "201") },
      },
      "/activities/{id}": {
        get: { summary: "Get an activity", parameters: idPath, responses: ok("Activity") },
        patch: { summary: "Change an activity's subject or body, or trash it", parameters: idPath, requestBody: body("ActivityInput"), responses: ok("Activity") },
      },
      "/pipelines": {
        get: {
          summary: "List pipelines and their stages",
          parameters: [{ name: "archived", in: "query", schema: bool }],
          responses: ok("PipelineList"),
        },
      },
      "/pipelines/{id}": { get: { summary: "Get a pipeline", parameters: idPath, responses: ok("Pipeline") } },
    },
  };
}
