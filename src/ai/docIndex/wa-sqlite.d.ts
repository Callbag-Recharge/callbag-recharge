// Type shim for @aspect-build/wa-sqlite — peer dependency, not bundled.
// Only the subset used by docIndex is declared here.
declare module "@aspect-build/wa-sqlite" {
	const factory: (...args: any[]) => Promise<any>;
	export default factory;
	export function SQLiteAPI(module: any): any;
	export function createTag(...args: any[]): any;
}
