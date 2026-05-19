export interface NewNoteRequest {
	directory: string;
	subject?: string;
	titleHint?: string;
}

class NewNoteController {
	open = $state(false);
	directory = $state('');
	subject = $state('');
	titleHint = $state('');

	request(args: NewNoteRequest) {
		this.directory = args.directory;
		this.subject = args.subject ?? '';
		this.titleHint = args.titleHint ?? '';
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const newNote = new NewNoteController();
