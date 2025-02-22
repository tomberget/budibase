<script>
  import { createEventDispatcher } from "svelte"
  import { tables, rows } from "stores/backend"
  import { notifications } from "@budibase/bbui"
  import RowFieldControl from "../RowFieldControl.svelte"
  import { API } from "api"
  import { ModalContent } from "@budibase/bbui"
  import { FIELDS } from "constants/backend"

  const FORMULA_TYPE = FIELDS.FORMULA.type

  export let row = {}

  let errors = []
  const dispatch = createEventDispatcher()

  $: creating = row?._id == null
  $: table = row.tableId
    ? $tables.list.find(table => table._id === row?.tableId)
    : $tables.selected
  $: tableSchema = Object.entries(table?.schema ?? {})

  async function saveRow() {
    errors = []
    try {
      await API.saveRow({ ...row, tableId: table._id })
      notifications.success("Row saved successfully")
      rows.save()
      dispatch("updaterows")
    } catch (error) {
      if (error.handled) {
        const response = error.json
        if (response?.errors) {
          errors = response.errors
        } else if (response?.validationErrors) {
          const mappedErrors = {}
          for (let field in response.validationErrors) {
            mappedErrors[
              field
            ] = `${field} ${response.validationErrors[field][0]}`
          }
          errors = mappedErrors
        }
      } else {
        notifications.error("Failed to save row")
      }
      // Prevent modal closing if there were errors
      return false
    }
  }
</script>

<ModalContent
  title={creating ? "Create Row" : "Edit Row"}
  confirmText={creating ? "Create Row" : "Save Row"}
  onConfirm={saveRow}
>
  {#each tableSchema as [key, meta]}
    {#if !meta.autocolumn && meta.type !== FORMULA_TYPE}
      <div>
        <RowFieldControl error={errors[key]} {meta} bind:value={row[key]} />
      </div>
    {/if}
  {/each}
</ModalContent>

<style>
  div {
    min-width: 0;
  }
</style>
