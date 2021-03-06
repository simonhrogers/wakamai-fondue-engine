import { NAME_TABLE, NAME_RECORD, CMAP_RECORD } from "../tools/variables.js";
import getCSS, { getCSSAsJSON } from "../tools/css/get-css.js";
import featureMapping from "../tools/features/layout-features.js";
import languageMapping from "../tools/ot-to-html-lang.js";
import getFormat from "../tools/summary/format.js";
import getFileSize from "../tools/summary/file-size.js";
import getFilename from "../tools/summary/filename.js";

export default class Fondue {
	constructor(font) {
		this._font = font;
	}

	get format() {
		return this._font.opentype.tables.CFF ? "OpenType/CFF" : "TrueType";
	}

	get isVariable() {
		return this._font.opentype.tables.fvar != undefined;
	}

	get isColor() {
		return this.colorFormats.length > 0;
	}

	get hasFeatures() {
		return this.features.length > 0;
	}

	get hasLanguages() {
		return this.languageSystems.length > 0;
	}

	// Return an object of all language systems supported by
	// either GSUB or GPOS. Tags are stripped ("ROM " → "ROM").
	get languageSystems() {
		const getLangs = (table) => {
			if (table) {
				return table
					.getSupportedScripts()
					.reduce((acc, script) => {
						const scriptTable = table.getScriptTable(script);
						return acc.concat(
							table.getSupportedLangSys(scriptTable)
						);
					}, [])
					.map((lang) => lang.trim());
			} else {
				return [];
			}
		};

		const gsubLangs = getLangs(this._font.opentype.tables.GSUB);
		const gposLangs = getLangs(this._font.opentype.tables.GPOS);
		const allLangs = new Set([...gsubLangs, ...gposLangs]);

		const langSys = languageMapping.filter((l) => allLangs.has(l.ot));
		return langSys;
	}

	// Gets all information about a table.
	// Examples:
	//   fondue.get('name') -> gets all relevant information from the name table.
	//   fondue.get() -> gets all relevant information about this font.
	get(tableString) {
		const tableStr = tableString || "";
		let table = undefined;
		if (this._font.opentype.tables) {
			table = this._raw(tableStr);
			if (table) {
				switch (tableStr) {
					case "":
						return {
							summary: this.summary,
							features: this.features,
							color: undefined,
							variable: this.variable,
							tables: this.tables,
							characters: undefined,
							css: this.css,
							cssString: this.cssString,
						};
					case "GPOS":
					case "GSUB": {
						let features = table.featureList.featureRecords.map(
							(record) => record.featureTag
						);
						features = features.filter(
							(feature, index) =>
								features.indexOf(feature) === index
						); // remove doubles
						let scripts = table.scriptList.scriptRecords.map(
							(record) => record.scriptTag
						);
						scripts = scripts.filter(
							(script, index) => scripts.indexOf(script) === index
						); // remove doubles
						return {
							features,
							scripts,
						};
					}
					case "cmap": {
						return table.encodingRecords.map((record) => {
							const cmapRecord = CMAP_RECORD[record.platformID];
							if (cmapRecord) {
								const platformId = cmapRecord.id,
									platformName = cmapRecord.name,
									encoding =
										cmapRecord.encoding &&
										cmapRecord.encoding[record.encodingID];
								return {
									platformId,
									platformName,
									encoding,
								};
							}
						});
					}
					case "fvar": {
						const instances = {};
						const axes = table
							.getSupportedAxes()
							.map((axis, index) => {
								const axisRaw = table.getAxis(axis);
								table.instances.map((instance) => {
									const name = this.name(
										instance.subfamilyNameID
									);
									if (!instances[name]) {
										instances[name] = {};
									}
									instances[name][axis] =
										instance.coordinates[index];
								});
								return {
									name: this.name(axisRaw.axisNameID),
									id: axisRaw.tag,
									min: axisRaw.minValue,
									max: axisRaw.maxValue,
									default: axisRaw.defaultValue,
									current: axisRaw.defaultValue,
								};
							});
						return { axes, instances };
					}
					case "name": {
						return table.nameRecords.map((record) => {
							const nameId = record.nameID;
							const platformId =
								NAME_RECORD[record.platformID].id;
							const platformName =
								NAME_RECORD[record.platformID].name;
							let predefined = undefined;
							if (NAME_TABLE[nameId]) {
								predefined = {
									name: NAME_TABLE[nameId].name,
									description: NAME_TABLE[nameId].description,
								};
							}
							const encoding =
								NAME_RECORD[record.platformID].encoding[
									record.encodingID
								];
							const language =
								NAME_RECORD[record.platformID].language[
									record.languageID
								];
							const value = this._removeNullBytes(
								this.name(nameId)
							);
							return {
								id: nameId,
								platformId,
								platformName,
								predefined,
								encoding,
								language,
								value,
							};
						});
					}
					default:
						break;
				}
			}
		}
		return undefined;
	}

	// Gets the raw Font object data from a specific table.
	// Examples:
	//   fondue._raw('fvar') -> gets the Font object table "fvar".
	//   fondue._raw() -> gets the raw Font object.
	_raw(tableString) {
		if (tableString) {
			if (
				this._font.opentype.tables[tableString] &&
				Object.keys(this._font.opentype.tables[tableString]).length
			) {
				return this._font.opentype.tables[tableString];
			}
			return undefined;
		}
		return this._font.opentype.tables;
	}

	// Gets all information about the font tables.
	// Usage:
	//   fondue.tables
	get tables() {
		const tables = Object.keys(this._raw());
		return tables.map((item) => {
			return {
				name: item,
				value: this.get(item),
				_raw: this._raw(item),
			};
		});
	}

	// Gets all information about the font features.
	// TODO: if feature has a UI Name ID, return its name
	//       https://github.com/Pomax/Font.js/issues/73
	// Usage:
	//   fondue.features
	get features() {
		const getRawFeatures = (table) => {
			if (!table) return [];
			return table.featureList.featureRecords.map(
				(record) => record.featureTag
			);
		};

		const getFeatureIndex = (rawFeature) => {
			const featureInitial = rawFeature.substring(0, 2);
			if (featureInitial == "ss" || featureInitial == "cv") {
				return `${featureInitial}##`;
			} else {
				return rawFeature;
			}
		};

		const rawFeatures = new Set([
			...getRawFeatures(this._raw("GSUB")),
			...getRawFeatures(this._raw("GPOS")),
		]);

		return [...rawFeatures].reduce((features, rawFeature) => {
			const featureIndex = getFeatureIndex(rawFeature);
			const feature = {
				...featureMapping.find((f) => f.tag == featureIndex),
			};
			if (feature) {
				// Restore original tag in case of enumerated tag (ss## or cv##)
				feature.tag = rawFeature;
				features.push(feature);
			}
			return features;
		}, []);
	}

	// Gets all information about the font's variable features.
	// Usage:
	//   fondue.variable
	get variable() {
		const fvar = this.get("fvar");
		return fvar;
	}

	// Return all color format tables.
	// Usage:
	//   fondue.colorFormats -> return e.g. ["SVG "] or empty array
	get colorFormats() {
		const colorTables = ["COLR", "sbix", "CBDT", "SVG"];
		const tables = this._font.opentype.directory.map((d) => d.tag.trim());
		return tables.filter((table) => colorTables.includes(table));
	}

	// Gets all information about the font summary.
	// Usage:
	//   fondue.summary
	get summary() {
		const summary = {};
		summary.Filename = getFilename(this);
		summary.Filesize = getFileSize(this);
		summary.Format = getFormat(this);
		this.get("name").forEach((record) => {
			if (record.value && record.predefined) {
				summary[record.predefined.name] = record.value;
			}
		});
		return summary;
	}

	// Gets the parsed CSS as an object, for this font.
	// Usage:
	//   fondue.css
	get css() {
		return getCSSAsJSON(this);
	}

	// Gets the parsed CSS as a string, for this font.
	// Usage:
	//   fondue.cssString
	get cssString() {
		return getCSS(this);
	}

	// Returns whether a specific character is supported by this font.
	// Example:
	//   fondue.supports('A') -> returns whether the character 'A' is supported by this font.
	supports(char) {
		return this._font.supports(char);
	}

	// Returns a name table entry by its nameID.
	// Example:
	//   fondue.name(0) -> returns the copyright notice.
	name(id) {
		const name = this._font.opentype.tables.name;
		if (name) {
			return name.get(id) || "";
		} else {
			return "";
		}
	}

	// Returns an array of all supported Unicode characters
	// from the "best" cmap.
	get supportedCharacters() {
		let chars = [];
		const cmap = this.getBestCmap();
		if (cmap) {
			for (const chunk of cmap) {
				for (let i = chunk.start; i < chunk.end + 1; i++) {
					// Skip 0xFFFF, Font.js currently reports this
					// as a supported character
					// https://github.com/Pomax/Font.js/issues/68
					if (i == 65535) continue;
					chars.push(i.toString(16));
				}
			}
		}
		return chars;
	}

	// Return the "best" unicode cmap dictionary available in the font,
	// or false, if no unicode cmap subtable is available.
	// Implementation of the awesome FontTools getBestCmap function.
	getBestCmap() {
		const cmapPreferences = [
			[3, 10],
			[0, 6],
			[0, 4],
			[3, 1],
			[0, 3],
			[0, 2],
			[0, 1],
			[0, 0],
		];
		for (const [platformID, platEncID] of cmapPreferences) {
			const cmapSubtable = this._font.opentype.tables.cmap.getSupportedCharCodes(
				platformID,
				platEncID
			);
			if (cmapSubtable) {
				return cmapSubtable;
			}
		}
		return null;
	}

	get customText() {
		const text = this._font.opentype.tables.name.get(19);
		return text ? this._removeNullBytes(text) : null;
	}

	_removeNullBytes(value) {
		// Currently Font.js returns null bytes in name table
		// strings, we filter them here.
		// https://github.com/Pomax/Font.js/issues/74
		/* eslint-disable no-control-regex */
		return value.replace(/\x00/g, "");
	}
}
