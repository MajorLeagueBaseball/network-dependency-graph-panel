import _, { map, flattenDeep, has, groupBy, values, reduce, merge, forOwn, keys } from 'lodash';
import Utils from '../util/Utils';
import { NetworkDependencyGraphCtrl } from '../network_dependency_graph_ctrl';
import { QueryResponse, GraphDataElement, GraphDataType, CurrentData } from '../types';

class PreProcessor {

	controller: NetworkDependencyGraphCtrl;

	constructor(controller: NetworkDependencyGraphCtrl) {
		this.controller = controller;
	}

	_transformTable(table: QueryResponse) {
		const objectTable = map(table.rows, row => {
			const rowObject: any = {};

			for (var i = 0; i < row.length; i++) {
				if (row[i] !== "") {
					const key = table.columns[i].text;
					rowObject[key] = row[i];
				}
			}

			return rowObject;
		});
		return objectTable;
	}

	_transformTables(tables: QueryResponse[]) {
		const result = map(tables, table => this._transformTable(table));
		return result;
	}

	_transformObjects(data: any[]): GraphDataElement[] {
		const { extOrigin: externalSource, extTarget: externalTarget, sourceComponentPrefix, targetComponentPrefix } = this.controller.getSettings().dataMapping;
		const aggregationSuffix: string = 'host';

		const peerColumn = 'remote_host';

		const result = map(data, dataObject => {
			let peer = has(dataObject, peerColumn);

			const result: GraphDataElement = {
        me: dataObject[aggregationSuffix],
				peer: "",
				data: dataObject,
				type: GraphDataType.INTERNAL
			};

			if (!peer) {
				result.type = GraphDataType.PEERLESS;
			} else {
        result.type = GraphDataType.PEERED;
        result.peer = dataObject[peerColumn];
			}
			return result;
		});

		const filteredResult: GraphDataElement[] = result.filter((element): element is GraphDataElement => element !== null);
		return filteredResult;
	}

	_mergeGraphData(data: GraphDataElement[]): GraphDataElement[] {
		const groupedData = values(groupBy(data, element => element.me + '<--->' + element.peer));

		const mergedData = map(groupedData, group => {
			return reduce(group, (result, next) => {
				return merge(result, next);
			}, <GraphDataElement>{});
		});

		return mergedData;
	}

	_cleanMetaData(columnMapping: any, metaData: any) {
		const result = {};

		forOwn(columnMapping, (value, key) => {
			if (has(metaData, value)) {
				result[key] = metaData[value];
			}
		});

		return result;
	}

	_cleanData(data: GraphDataElement[]): GraphDataElement[] {
		const columnMapping = {};
		columnMapping['bps_rx'] = Utils.getConfig(this.controller, 'bpsRxColumn');
		columnMapping['eps_rx'] = Utils.getConfig(this.controller, 'epsRxColumn');
		columnMapping['pps_rx'] = Utils.getConfig(this.controller, 'ppsRxColumn');
		columnMapping['bps_tx'] = Utils.getConfig(this.controller, 'bpsTxColumn');
		columnMapping['eps_tx'] = Utils.getConfig(this.controller, 'epsTxColumn');
		columnMapping['pps_tx'] = Utils.getConfig(this.controller, 'ppsTxColumn');
    columnMapping['if_name'] = Utils.getConfig(this.controller, 'ifNameColumn');
    columnMapping['peer_if_name'] = Utils.getConfig(this.controller, 'remoteIfNameColumn');

		const cleanedData = map(data, dataElement => {
			const cleanedMetaData = this._cleanMetaData(columnMapping, dataElement.data);

			const result = {
				...dataElement,
				data: cleanedMetaData
			};

			return result;
		});

		return cleanedData;
	}

	_extractColumnNames(data: GraphDataElement[]): string[] {
		const columnNames: string[] = _(data)
			.flatMap(dataElement => keys(dataElement.data))
			.uniq()
			.sort()
			.value();

		return columnNames;
	}

	processData(inputData: QueryResponse[]): CurrentData {
		const objectTables = this._transformTables(inputData);

		const flattenData = flattenDeep(objectTables);

		const graphElements = this._transformObjects(flattenData);

		const mergedData = this._mergeGraphData(graphElements);
		const columnNames = this._extractColumnNames(mergedData);

		const cleanData = this._cleanData(mergedData);

		console.groupCollapsed('Data transformation log');
		console.log('Transform tables:', objectTables);
		console.log('Flat data:', flattenData);
		console.log('Graph elements:', graphElements);
		console.log('Merged graph data:', mergedData);
		console.log('Cleaned data:', cleanData);
		console.log('Table columns:', columnNames);
		console.groupEnd();

		return {
			graph: cleanData,
			raw: inputData,
			columnNames: columnNames
		};
	}
};

export default PreProcessor;
