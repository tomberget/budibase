const { FieldTypes } = require("../../constants")

/**
 * A map of how we convert various properties in rows to each other based on the row type.
 */
exports.TYPE_TRANSFORM_MAP = {
  [FieldTypes.LINK]: {
    "": [],
    [null]: [],
    [undefined]: undefined,
    parse: link => {
      if (Array.isArray(link) && typeof link[0] === "object") {
        return link.map(el => (el && el._id ? el._id : el))
      }
      if (typeof link === "string") {
        return [link]
      }
      return link
    },
  },
  [FieldTypes.OPTIONS]: {
    "": null,
    [null]: null,
    [undefined]: undefined,
  },
  [FieldTypes.ARRAY]: {
    "": [],
    [null]: [],
    [undefined]: undefined,
  },
  [FieldTypes.STRING]: {
    "": "",
    [null]: "",
    [undefined]: undefined,
  },
  [FieldTypes.BARCODEQR]: {
    "": "",
    [null]: "",
    [undefined]: undefined,
  },
  [FieldTypes.FORMULA]: {
    "": "",
    [null]: "",
    [undefined]: undefined,
  },
  [FieldTypes.LONGFORM]: {
    "": "",
    [null]: "",
    [undefined]: undefined,
  },
  [FieldTypes.NUMBER]: {
    "": null,
    [null]: null,
    [undefined]: undefined,
    parse: n => parseFloat(n),
  },
  [FieldTypes.DATETIME]: {
    "": null,
    [undefined]: undefined,
    [null]: null,
    parse: date => {
      if (date instanceof Date) {
        return date.toISOString()
      }
      return date
    },
  },
  [FieldTypes.ATTACHMENT]: {
    "": [],
    [null]: [],
    [undefined]: undefined,
  },
  [FieldTypes.BOOLEAN]: {
    "": null,
    [null]: null,
    [undefined]: undefined,
    true: true,
    false: false,
  },
  [FieldTypes.AUTO]: {
    parse: () => undefined,
  },
  [FieldTypes.JSON]: {
    parse: input => {
      try {
        if (input === "") {
          return undefined
        }
        return JSON.parse(input)
      } catch (err) {
        return input
      }
    },
  },
}
