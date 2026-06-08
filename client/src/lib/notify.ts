import { toast } from "sonner";

export const notify = {
	error(message: string) {
		toast.error(message);
	},
	success(message: string) {
		toast.success(message);
	},
	info(message: string) {
		toast.info(message);
	},
	warning(message: string) {
		toast.warning(message);
	},
};
