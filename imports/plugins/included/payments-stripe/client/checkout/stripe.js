/* eslint camelcase: 0 */
import { Meteor } from "meteor/meteor";
import { Template } from "meteor/templating";
import { AutoForm } from "meteor/aldeed:autoform";
import { $ } from "meteor/jquery";
import { getCardType } from "/client/modules/core/helpers/globals";
import { Reaction } from "/client/api";
import { Cart, SellerShops, Packages } from "/lib/collections";
import { Stripe } from "../../lib/api";
import { StripePayment } from "../../lib/collections/schemas";

import "./stripe.html";

let submitting = false;

//
// local helpers
//
function uiEnd(template, buttonText) {
  template.$(":input").removeAttr("disabled");
  template.$("#btn-complete-order").text(buttonText);
  return template.$("#btn-processing").addClass("hidden");
}

function paymentAlert(errorMessage) {
  return $(".alert").removeClass("hidden").text(errorMessage);
}

function hidePaymentAlert() {
  return $(".alert").addClass("hidden").text("");
}

function handleStripeSubmitError(error) {
  // Match eror on card number. Not submitted to stripe
  if (error && error.reason && error.reason === "Match failed") {
    const message = "Your card number is invalid. Please check the number and try again";
    return paymentAlert(message);
  }

  // this is a server message with a client-sanitized message
  if (error && error.details) {
    return paymentAlert(error.details);
  }
}

//
// Template helpers
//
Template.stripePaymentForm.helpers({
  StripePayment() {
    return StripePayment;
  }
});

//
// autoform handling
//
AutoForm.addHooks("stripe-payment-form", {
  onSubmit(doc) {
    submitting = true;
    const template = this.template;
    hidePaymentAlert();
    const cardData = {
      name: doc.payerName,
      number: doc.cardNumber,
      expire_month: doc.expireMonth,
      expire_year: doc.expireYear,
      cvv2: doc.cvv,
      type: getCardType(doc.cardNumber)
    };
    const storedCard = cardData.type.charAt(0).toUpperCase() + cardData.type.slice(1) + " " + doc.cardNumber.slice(-4);
    Stripe.authorize(cardData, {
      total: Cart.findOne().cartTotal(),
      currency: SellerShops.findOne().currency
      // Commenting this out because it causes tests to fail and isn't fully implemented.
      // shopId: SellerShops.findOne()._id // TODO: Implement Marketplace Payments
    }, function (error, transaction) {
      submitting = false;
      if (error) {
        handleStripeSubmitError(error);
        uiEnd(template, "Resubmit payment");
      } else {
        if (transaction.saved === true) {
          const normalizedStatus = (function () {
            switch (false) {
              case !(!transaction.response.captured && !transaction.response.failure_code):
                return "created";
              case !(transaction.response.captured === true && !transaction.response.failure_code):
                return "settled";
              case !transaction.response.failure_code:
                return "failed";
              default:
                return "failed";
            }
          })();
          const normalizedMode = (function () {
            switch (false) {
              case !(!transaction.response.captured && !transaction.response.failure_code):
                return "authorize";
              case !transaction.response.captured:
                return "capture";
              default:
                return "capture";
            }
          })();
          Meteor.subscribe("Packages", Reaction.getShopId());
          const packageData = Packages.findOne({
            name: "reaction-stripe",
            shopId: Reaction.getShopId()
          });

          submitting = false;
          const paymentMethod = {
            processor: "Stripe",
            storedCard: storedCard,
            method: "credit",
            paymentPackageId: packageData._id,
            paymentSettingsKey: packageData.registry[0].settingsKey,
            transactionId: transaction.response.id,
            amount: transaction.response.amount * 0.01,
            status: normalizedStatus,
            mode: normalizedMode,
            createdAt: new Date(transaction.response.created),
            transactions: []
          };
          paymentMethod.transactions.push(transaction.response);
          Meteor.call("cart/submitPayment", paymentMethod);
        } else {
          handleStripeSubmitError(transaction.error);
          uiEnd(template, "Resubmit payment");
        }
      }
    });
    return false;
  },
  beginSubmit() {
    this.template.$(":input").attr("disabled", true);
    this.template.$("#btn-complete-order").text("Submitting ");
    return this.template.$("#btn-processing").removeClass("hidden");
  },
  endSubmit() {
    if (!submitting) {
      return uiEnd(this.template, "Complete your order");
    }
  }
});
