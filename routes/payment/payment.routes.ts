import { Router, Request, Response } from "express";
import { payOS } from "../../utils/payos.js";
import { fulfillTransactionService } from "../wallet/wallet.service.js";

export function createPaymentRouter(): Router {
    const router = Router();

    router.post("/payos", async (req: Request, res: Response) => {
        try {
            const webhookData = payOS.verifyPaymentWebhookData(req.body);

            if (["Ma giao dich thu nghiem", "VQRIO123"].includes(webhookData.description)) {
                return res.json({ error: 0, message: "Ok", data: webhookData });
            }

            const orderCode = webhookData.orderCode;
            
            if (webhookData.code === "00") {
                await fulfillTransactionService(orderCode);
            }

            return res.json({ error: 0, message: "Ok", data: webhookData });
        } catch (err) {
            console.error("Webhook processing error:", err);
            return res.json({ error: -1, message: "fail", data: null });
        }
    });

    return router;
}
