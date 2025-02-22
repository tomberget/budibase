import actions from "../../automations/actions"
import triggers from "../../automations/triggers"
import {
  getAutomationParams,
  generateAutomationID,
  DocumentType,
} from "../../db/utils"
import {
  checkForWebhooks,
  updateTestHistory,
  removeDeprecated,
} from "../../automations/utils"
import { deleteEntityMetadata } from "../../utilities"
import { MetadataTypes } from "../../constants"
import { setTestFlag, clearTestFlag } from "../../utilities/redis"
import { context, cache, events } from "@budibase/backend-core"
import { automations } from "@budibase/pro"
import { Automation, BBContext } from "@budibase/types"

const ACTION_DEFS = removeDeprecated(actions.ACTION_DEFINITIONS)
const TRIGGER_DEFS = removeDeprecated(triggers.TRIGGER_DEFINITIONS)

/*************************
 *                       *
 *   BUILDER FUNCTIONS   *
 *                       *
 *************************/

async function cleanupAutomationMetadata(automationId: string) {
  await deleteEntityMetadata(MetadataTypes.AUTOMATION_TEST_INPUT, automationId)
  await deleteEntityMetadata(
    MetadataTypes.AUTOMATION_TEST_HISTORY,
    automationId
  )
}

function cleanAutomationInputs(automation: Automation) {
  if (automation == null) {
    return automation
  }
  let steps = automation.definition.steps
  let trigger = automation.definition.trigger
  let allSteps = [...steps, trigger]
  // live is not a property used anymore
  if (automation.live != null) {
    delete automation.live
  }
  for (let step of allSteps) {
    if (step == null) {
      continue
    }
    for (let inputName of Object.keys(step.inputs)) {
      if (!step.inputs[inputName] || step.inputs[inputName] === "") {
        delete step.inputs[inputName]
      }
    }
  }
  return automation
}

export async function create(ctx: BBContext) {
  const db = context.getAppDB()
  let automation = ctx.request.body
  automation.appId = ctx.appId

  // call through to update if already exists
  if (automation._id && automation._rev) {
    return update(ctx)
  }

  automation._id = generateAutomationID()

  automation.type = "automation"
  automation = cleanAutomationInputs(automation)
  automation = await checkForWebhooks({
    newAuto: automation,
  })
  const response = await db.put(automation)
  await events.automation.created(automation)
  for (let step of automation.definition.steps) {
    await events.automation.stepCreated(automation, step)
  }
  automation._rev = response.rev

  ctx.status = 200
  ctx.body = {
    message: "Automation created successfully",
    automation: {
      ...automation,
      ...response,
    },
  }
}

export function getNewSteps(oldAutomation: Automation, automation: Automation) {
  const oldStepIds = oldAutomation.definition.steps.map(s => s.id)
  return automation.definition.steps.filter(s => !oldStepIds.includes(s.id))
}

export function getDeletedSteps(
  oldAutomation: Automation,
  automation: Automation
) {
  const stepIds = automation.definition.steps.map(s => s.id)
  return oldAutomation.definition.steps.filter(s => !stepIds.includes(s.id))
}

export async function handleStepEvents(
  oldAutomation: Automation,
  automation: Automation
) {
  // new steps
  const newSteps = getNewSteps(oldAutomation, automation)
  for (let step of newSteps) {
    await events.automation.stepCreated(automation, step)
  }

  // old steps
  const deletedSteps = getDeletedSteps(oldAutomation, automation)
  for (let step of deletedSteps) {
    await events.automation.stepDeleted(automation, step)
  }
}

export async function update(ctx: BBContext) {
  const db = context.getAppDB()
  let automation = ctx.request.body
  automation.appId = ctx.appId
  const oldAutomation = await db.get(automation._id)
  automation = cleanAutomationInputs(automation)
  automation = await checkForWebhooks({
    oldAuto: oldAutomation,
    newAuto: automation,
  })
  const response = await db.put(automation)
  automation._rev = response.rev

  const oldAutoTrigger =
    oldAutomation && oldAutomation.definition.trigger
      ? oldAutomation.definition.trigger
      : undefined
  const newAutoTrigger =
    automation && automation.definition.trigger
      ? automation.definition.trigger
      : {}
  // trigger has been updated, remove the test inputs
  if (oldAutoTrigger && oldAutoTrigger.id !== newAutoTrigger.id) {
    await events.automation.triggerUpdated(automation)
    await deleteEntityMetadata(
      MetadataTypes.AUTOMATION_TEST_INPUT,
      automation._id!
    )
  }

  await handleStepEvents(oldAutomation, automation)

  ctx.status = 200
  ctx.body = {
    message: `Automation ${automation._id} updated successfully.`,
    automation: {
      ...automation,
      _rev: response.rev,
      _id: response.id,
    },
  }
}

export async function fetch(ctx: BBContext) {
  const db = context.getAppDB()
  const response = await db.allDocs(
    getAutomationParams(null, {
      include_docs: true,
    })
  )
  ctx.body = response.rows.map(row => row.doc)
}

export async function find(ctx: BBContext) {
  const db = context.getAppDB()
  ctx.body = await db.get(ctx.params.id)
}

export async function destroy(ctx: BBContext) {
  const db = context.getAppDB()
  const automationId = ctx.params.id
  const oldAutomation = await db.get(automationId)
  await checkForWebhooks({
    oldAuto: oldAutomation,
  })
  // delete metadata first
  await cleanupAutomationMetadata(automationId)
  ctx.body = await db.remove(automationId, ctx.params.rev)
  await events.automation.deleted(oldAutomation)
}

export async function logSearch(ctx: BBContext) {
  ctx.body = await automations.logs.logSearch(ctx.request.body)
}

export async function clearLogError(ctx: BBContext) {
  const { automationId, appId } = ctx.request.body
  await context.doInAppContext(appId, async () => {
    const db = context.getProdAppDB()
    const metadata = await db.get(DocumentType.APP_METADATA)
    if (!automationId) {
      delete metadata.automationErrors
    } else if (
      metadata.automationErrors &&
      metadata.automationErrors[automationId]
    ) {
      delete metadata.automationErrors[automationId]
    }
    await db.put(metadata)
    await cache.app.invalidateAppMetadata(metadata.appId, metadata)
    ctx.body = { message: `Error logs cleared.` }
  })
}

export async function getActionList(ctx: BBContext) {
  ctx.body = ACTION_DEFS
}

export async function getTriggerList(ctx: BBContext) {
  ctx.body = TRIGGER_DEFS
}

export async function getDefinitionList(ctx: BBContext) {
  ctx.body = {
    trigger: TRIGGER_DEFS,
    action: ACTION_DEFS,
  }
}

/*********************
 *                   *
 *   API FUNCTIONS   *
 *                   *
 *********************/

export async function trigger(ctx: BBContext) {
  const db = context.getAppDB()
  let automation = await db.get(ctx.params.id)
  await triggers.externalTrigger(automation, {
    ...ctx.request.body,
    appId: ctx.appId,
  })
  ctx.body = {
    message: `Automation ${automation._id} has been triggered.`,
    automation,
  }
}

function prepareTestInput(input: any) {
  // prepare the test parameters
  if (input.id && input.row) {
    input.row._id = input.id
  }
  if (input.revision && input.row) {
    input.row._rev = input.revision
  }
  return input
}

export async function test(ctx: BBContext) {
  const db = context.getAppDB()
  let automation = await db.get(ctx.params.id)
  await setTestFlag(automation._id)
  const testInput = prepareTestInput(ctx.request.body)
  const response = await triggers.externalTrigger(
    automation,
    {
      ...testInput,
      appId: ctx.appId,
    },
    { getResponses: true }
  )
  // save a test history run
  await updateTestHistory(ctx.appId, automation, {
    ...ctx.request.body,
    occurredAt: new Date().getTime(),
  })
  await clearTestFlag(automation._id)
  ctx.body = response
  await events.automation.tested(automation)
}
