export interface NoteFrontmatter {
	title: string;
	date: string;
	location?: string;
	slide_url?: string;
	tags?: string[];
}

export interface Timetable {
	[dayOfWeek: string]: {
		[period: string]: {
			subject: string;
			directory: string;
		};
	};
}

export interface TaskItem {
	id: string;
	filePath: string;
	subject: string;
	content: string;
	isCompleted: boolean;
}

export type TreeNodeType = 'file' | 'directory';

export interface TreeNode {
	name: string;
	path: string;
	type: TreeNodeType;
	children?: TreeNode[];
}
